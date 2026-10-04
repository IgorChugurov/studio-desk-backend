import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { loadEnv } from '../../../config/env.js';
import {
  type Database,
  PLATFORM_DB,
} from '../../../database/database.module.js';
import {
  authSession,
  platformAdministrator,
  signInCode,
} from '../../../database/schema/index.js';
import { type Mailer, MAILER } from './mailer.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_TTL_SECONDS,
  MAX_ATTEMPTS,
  newRefreshToken,
  newSignInCode,
  readAccessToken,
  RESEND_WAIT_SECONDS,
  ROTATION_WINDOW_MS,
  sameHash,
  SESSION_ABSOLUTE_MS,
  SESSION_SLIDING_MS,
  sha256,
  signAccessToken,
} from './tokens.js';

const CODE_EXPIRES_IN = CODE_TTL_SECONDS;
const RESEND_AVAILABLE_IN = RESEND_WAIT_SECONDS;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PLATFORM_DB) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async requestCode(email: string) {
    const issued = await this.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`delete from sign_in_code where expires_at < now() - interval '1 hour'`,
        );
        const existing = await tx.execute(sql`
        select email, created_at
          from sign_in_code
         where email = ${email}
         for update
      `);
        const row = existing.rows[0] as CodeRow | undefined;
        if (
          row &&
          Date.now() - new Date(row.created_at).getTime() <
            RESEND_WAIT_SECONDS * 1000
        ) {
          return { tooEarly: true as const };
        }

        const code = newSignInCode();
        const now = new Date();
        const values = {
          codeHash: sha256(code),
          createdAt: now,
          expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
          attemptsRemaining: MAX_ATTEMPTS,
        };
        if (row) {
          await tx
            .update(signInCode)
            .set(values)
            .where(eq(signInCode.email, email));
        } else {
          await tx.insert(signInCode).values({ email, ...values });
        }

        const admin = await tx
          .select({ id: platformAdministrator.id })
          .from(platformAdministrator)
          .where(eq(platformAdministrator.email, email));
        return { tooEarly: false as const, code, send: admin.length > 0 };
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return { tooEarly: true as const };
        throw error;
      });

    if (issued.tooEarly) {
      throw new ApiError({
        statusCode: 429,
        code: 'RESEND_TOO_EARLY',
        message: 'Please wait before requesting a new code',
      });
    }
    if (issued.send) {
      void this.mailer
        .sendSignInCode(email, issued.code)
        .catch((error: unknown) => {
          this.logger.error(
            error instanceof Error
              ? error.message
              : 'Sign-in code was not sent',
          );
        });
    }
    return {
      codeExpiresIn: CODE_EXPIRES_IN,
      resendAvailableIn: RESEND_AVAILABLE_IN,
    };
  }

  async signIn(email: string, code: string) {
    const outcome = await this.db.transaction(async (tx) => {
      const existing = await tx.execute(sql`
        select code_hash, created_at, expires_at, attempts_remaining
          from sign_in_code
         where email = ${email}
         for update
      `);
      const row = existing.rows[0] as FullCodeRow | undefined;
      if (!row) return { error: 'INVALID_CODE' as const };
      if (row.attempts_remaining <= 0)
        return { error: 'TOO_MANY_ATTEMPTS' as const };
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return { error: 'CODE_EXPIRED' as const };
      }

      const admin = await tx
        .select({
          id: platformAdministrator.id,
          email: platformAdministrator.email,
        })
        .from(platformAdministrator)
        .where(eq(platformAdministrator.email, email));
      const person = admin[0];
      const accepted =
        person !== undefined && sameHash(sha256(code), row.code_hash);
      if (!accepted || !person) {
        const remaining = row.attempts_remaining - 1;
        await tx
          .update(signInCode)
          .set({ attemptsRemaining: remaining })
          .where(eq(signInCode.email, email));
        return {
          error: (remaining <= 0 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE') as
            'TOO_MANY_ATTEMPTS' | 'INVALID_CODE',
        };
      }

      await tx.delete(signInCode).where(eq(signInCode.email, email));
      const now = new Date();
      const refreshToken = newRefreshToken();
      const inserted = await tx
        .insert(authSession)
        .values({
          platformAdministratorId: person.id,
          api: 'platform',
          expiresAt: new Date(now.getTime() + SESSION_SLIDING_MS),
          refreshTokenHash: sha256(refreshToken),
        })
        .returning({ id: authSession.id });
      const created = inserted[0];
      if (!created) throw new Error('session was not created');
      return {
        error: undefined,
        refreshToken,
        accessToken: signAccessToken(
          { sub: person.id, sid: created.id, api: 'platform' },
          loadEnv().ACCESS_TOKEN_SECRET,
          now.getTime(),
        ),
        email: person.email,
      };
    });

    if (outcome.error) throw signInError(outcome.error);
    return {
      accessToken: outcome.accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: outcome.refreshToken,
      user: { email: outcome.email },
    };
  }

  async refresh(refreshToken: string) {
    const hash = sha256(refreshToken);
    const outcome = await this.db.transaction(async (tx) => {
      const found = await tx.execute(sql`
        select id, platform_administrator_id, created_at, expires_at, revoked_at,
               refresh_token_hash, previous_refresh_token_hash, rotated_at
          from session
         where refresh_token_hash = ${hash}
            or previous_refresh_token_hash = ${hash}
         for update
      `);
      const row = found.rows[0] as SessionRow | undefined;
      if (!row || row.revoked_at) return { expired: true as const };

      const now = Date.now();
      const created = new Date(row.created_at).getTime();
      const absoluteEnd = created + SESSION_ABSOLUTE_MS;
      if (new Date(row.expires_at).getTime() <= now || absoluteEnd <= now) {
        return { expired: true as const };
      }

      const current = sameHash(row.refresh_token_hash, hash);
      const previous =
        row.previous_refresh_token_hash !== null &&
        sameHash(row.previous_refresh_token_hash, hash);
      if (!current && !previous) return { expired: true as const };
      if (
        previous &&
        (row.rotated_at === null ||
          now - new Date(row.rotated_at).getTime() > ROTATION_WINDOW_MS)
      ) {
        await tx
          .update(authSession)
          .set({ revokedAt: new Date(now) })
          .where(eq(authSession.id, row.id));
        return { expired: true as const };
      }

      const nextToken = newRefreshToken();
      const admin = await tx
        .select({ email: platformAdministrator.email })
        .from(platformAdministrator)
        .where(eq(platformAdministrator.id, row.platform_administrator_id));
      const person = admin[0];
      if (!person) return { expired: true as const };
      await tx
        .update(authSession)
        .set({
          refreshTokenHash: sha256(nextToken),
          previousRefreshTokenHash: row.refresh_token_hash,
          rotatedAt: new Date(now),
          expiresAt: new Date(Math.min(now + SESSION_SLIDING_MS, absoluteEnd)),
        })
        .where(eq(authSession.id, row.id));
      return {
        expired: false as const,
        refreshToken: nextToken,
        accessToken: signAccessToken(
          {
            sub: row.platform_administrator_id,
            sid: row.id,
            api: 'platform',
          },
          loadEnv().ACCESS_TOKEN_SECRET,
          now,
        ),
        email: person.email,
      };
    });

    if (outcome.expired) {
      throw new ApiError({
        statusCode: 401,
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Sign in again',
      });
    }
    return {
      accessToken: outcome.accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: outcome.refreshToken,
      user: { email: outcome.email },
    };
  }

  async signOut(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const hash = sha256(refreshToken);
    await this.db
      .update(authSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          isNull(authSession.revokedAt),
          sql`${authSession.refreshTokenHash} = ${hash} or ${authSession.previousRefreshTokenHash} = ${hash}`,
        ),
      );
  }

  /** Used by the platform guard: a signed token whose session is still live. */
  async authenticateAccessToken(token: string) {
    const claims = readClaims(token);
    if (!claims) return undefined;
    const rows = await this.db
      .select({
        id: authSession.id,
        api: authSession.api,
        createdAt: authSession.createdAt,
        expiresAt: authSession.expiresAt,
        revokedAt: authSession.revokedAt,
        platformAdministratorId: authSession.platformAdministratorId,
      })
      .from(authSession)
      .where(eq(authSession.id, claims.sid));
    const row = rows[0];
    const now = Date.now();
    if (
      !row ||
      row.revokedAt ||
      row.api !== 'platform' ||
      row.platformAdministratorId !== claims.sub ||
      row.expiresAt.getTime() <= now ||
      row.createdAt.getTime() + SESSION_ABSOLUTE_MS <= now
    ) {
      return undefined;
    }
    return claims;
  }
}

interface CodeRow {
  email: string;
  created_at: Date | string;
}

interface FullCodeRow {
  code_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  attempts_remaining: number;
}

interface SessionRow {
  id: string;
  platform_administrator_id: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  refresh_token_hash: string;
  previous_refresh_token_hash: string | null;
  rotated_at: Date | string | null;
}

function readClaims(token: string) {
  return readAccessToken(token, loadEnv().ACCESS_TOKEN_SECRET);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function signInError(
  code: 'INVALID_CODE' | 'CODE_EXPIRED' | 'TOO_MANY_ATTEMPTS',
) {
  if (code === 'CODE_EXPIRED') {
    return new ApiError({
      statusCode: 400,
      code,
      message: 'The code has expired. Request a new one',
    });
  }
  if (code === 'TOO_MANY_ATTEMPTS') {
    return new ApiError({
      statusCode: 429,
      code,
      message: 'Too many attempts. Try again later',
    });
  }
  return new ApiError({
    statusCode: 400,
    code,
    message: 'Invalid or expired code',
  });
}
