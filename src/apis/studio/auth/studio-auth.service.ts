import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { type Mailer, MAILER } from '../../../common/auth/mailer.js';
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
} from '../../../common/auth/tokens.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { loadEnv } from '../../../config/env.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  studioSelectionTicket,
  studioSession,
  studioSignInCode,
} from '../../../database/schema/index.js';
import { SELECTION_TICKET_TTL_SECONDS } from './studio-cookie.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface StudioRef {
  id: string;
  name: string;
}

/** What the guard knows about a live studio session. */
export interface StudioSessionInfo {
  sessionId: string;
  email: string;
  studioId: string;
  impersonatedBy: string | null;
}

export interface SessionResult {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: { email: string };
  studio: StudioRef;
}

export type SignInResult =
  | ({ result: 'signed-in' } & SessionResult)
  | {
      result: 'studio-selection';
      selectionTicket: string;
      selectionTicketExpiresIn: number;
      studios: StudioRef[];
    };

@Injectable()
export class StudioAuthService {
  private readonly logger = new Logger(StudioAuthService.name);

  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async requestCode(email: string) {
    const issued = await this.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`delete from studio_sign_in_code where expires_at < now() - interval '1 hour'`,
        );
        const existing = await tx.execute(sql`
          select email, created_at
            from studio_sign_in_code
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
            .update(studioSignInCode)
            .set(values)
            .where(eq(studioSignInCode.email, email));
        } else {
          await tx.insert(studioSignInCode).values({ email, ...values });
        }

        const studios = await findStudios(tx, email);
        return {
          tooEarly: false as const,
          code,
          send: studios.length > 0,
        };
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
      codeExpiresIn: CODE_TTL_SECONDS,
      resendAvailableIn: RESEND_WAIT_SECONDS,
    };
  }

  async signIn(email: string, code: string): Promise<SignInResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const existing = await tx.execute(sql`
        select code_hash, created_at, expires_at, attempts_remaining
          from studio_sign_in_code
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

      const studios = await findStudios(tx, email);
      const hashMatches = sameHash(sha256(code), row.code_hash);
      if (!hashMatches || studios.length === 0) {
        const remaining = row.attempts_remaining - 1;
        await tx
          .update(studioSignInCode)
          .set({ attemptsRemaining: remaining })
          .where(eq(studioSignInCode.email, email));
        return {
          error: (remaining <= 0 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE') as
            'TOO_MANY_ATTEMPTS' | 'INVALID_CODE',
        };
      }

      await tx
        .delete(studioSignInCode)
        .where(eq(studioSignInCode.email, email));

      const only = studios.length === 1 ? studios[0] : undefined;
      if (only) {
        const session = await createSession(tx, email, only, null);
        return { error: undefined, value: signedIn(session) };
      }

      // A new ticket replaces every earlier ticket of this person; tickets of
      // others that expired more than an hour ago are removed on the way.
      await tx
        .delete(studioSelectionTicket)
        .where(
          or(
            eq(studioSelectionTicket.email, email),
            lt(
              studioSelectionTicket.expiresAt,
              new Date(Date.now() - 60 * 60 * 1000),
            ),
          ),
        );
      const ticket = newRefreshToken();
      await tx.insert(studioSelectionTicket).values({
        tokenHash: sha256(ticket),
        email,
        expiresAt: new Date(Date.now() + SELECTION_TICKET_TTL_SECONDS * 1000),
      });
      return {
        error: undefined,
        value: {
          result: 'studio-selection' as const,
          selectionTicket: ticket,
          selectionTicketExpiresIn: SELECTION_TICKET_TTL_SECONDS,
          studios,
        },
      };
    });

    if (outcome.error) throw signInError(outcome.error);
    return outcome.value;
  }

  async selectStudio(
    selectionTicket: string,
    studioId: string,
  ): Promise<SessionResult> {
    const hash = sha256(selectionTicket);
    return this.db.transaction(async (tx) => {
      const found = await tx.execute(sql`
        select id, email, expires_at, used_at
          from studio_selection_ticket
         where token_hash = ${hash}
         for update
      `);
      const row = found.rows[0] as TicketRow | undefined;
      if (
        !row ||
        row.used_at !== null ||
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        throw new ApiError({
          statusCode: 400,
          code: 'INVALID_SELECTION_TICKET',
          message: 'The selection ticket is invalid or expired',
        });
      }

      const chosen = (await findStudios(tx, row.email)).find(
        (item) => item.id === studioId,
      );
      if (!chosen) throw ApiError.notFound('Studio not found');

      await tx
        .update(studioSelectionTicket)
        .set({ usedAt: new Date() })
        .where(eq(studioSelectionTicket.id, row.id));
      return createSession(tx, row.email, chosen, null);
    });
  }

  /** New session of another studio of the same person; the current one is revoked. */
  async switchStudio(
    current: StudioSessionInfo,
    studioId: string,
  ): Promise<SessionResult> {
    return this.db.transaction(async (tx) => {
      const chosen = (await findStudios(tx, current.email)).find(
        (item) => item.id === studioId,
      );
      if (!chosen) throw ApiError.notFound('Studio not found');

      await tx
        .update(studioSession)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(studioSession.id, current.sessionId),
            isNull(studioSession.revokedAt),
          ),
        );
      return createSession(tx, current.email, chosen, current.impersonatedBy);
    });
  }

  async refresh(refreshToken: string): Promise<SessionResult> {
    const hash = sha256(refreshToken);
    const outcome = await this.db.transaction(async (tx) => {
      const found = await tx.execute(sql`
        select id, studio_id, email, created_at, expires_at, revoked_at,
               refresh_token_hash, previous_refresh_token_hash, rotated_at
          from studio_session
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
          .update(studioSession)
          .set({ revokedAt: new Date(now) })
          .where(eq(studioSession.id, row.id));
        return { expired: true as const };
      }

      const studioRows = await tx.execute(
        sql`select id, name from studio where id = ${row.studio_id}`,
      );
      const studio = studioRows.rows[0] as StudioRef | undefined;
      if (!studio) return { expired: true as const };

      const nextToken = newRefreshToken();
      await tx
        .update(studioSession)
        .set({
          refreshTokenHash: sha256(nextToken),
          previousRefreshTokenHash: row.refresh_token_hash,
          rotatedAt: new Date(now),
          expiresAt: new Date(Math.min(now + SESSION_SLIDING_MS, absoluteEnd)),
        })
        .where(eq(studioSession.id, row.id));
      return {
        expired: false as const,
        value: {
          accessToken: signAccessToken(
            {
              sub: row.email,
              sid: row.id,
              api: 'studio',
              studioId: row.studio_id,
            },
            loadEnv().ACCESS_TOKEN_SECRET,
            now,
          ),
          accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: nextToken,
          user: { email: row.email },
          studio: { id: studio.id, name: studio.name },
        },
      };
    });

    if (outcome.expired) {
      throw new ApiError({
        statusCode: 401,
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Sign in again',
      });
    }
    return outcome.value;
  }

  async signOut(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const hash = sha256(refreshToken);
    await this.db
      .update(studioSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          isNull(studioSession.revokedAt),
          sql`${studioSession.refreshTokenHash} = ${hash} or ${studioSession.previousRefreshTokenHash} = ${hash}`,
        ),
      );
  }

  /** Used by the studio guard: a signed studio token whose session is still live. */
  async authenticateAccessToken(
    token: string,
  ): Promise<StudioSessionInfo | undefined> {
    const claims = readAccessToken(
      token,
      loadEnv().ACCESS_TOKEN_SECRET,
      'studio',
    );
    if (!claims?.studioId) return undefined;
    const rows = await this.db
      .select({
        id: studioSession.id,
        studioId: studioSession.studioId,
        email: studioSession.email,
        createdAt: studioSession.createdAt,
        expiresAt: studioSession.expiresAt,
        revokedAt: studioSession.revokedAt,
        impersonatedBy: studioSession.impersonatedBy,
      })
      .from(studioSession)
      .where(eq(studioSession.id, claims.sid));
    const row = rows[0];
    const now = Date.now();
    if (
      !row ||
      row.revokedAt ||
      row.email !== claims.sub ||
      row.studioId !== claims.studioId ||
      row.expiresAt.getTime() <= now ||
      row.createdAt.getTime() + SESSION_ABSOLUTE_MS <= now
    ) {
      return undefined;
    }
    return {
      sessionId: row.id,
      email: row.email,
      studioId: row.studioId,
      impersonatedBy: row.impersonatedBy,
    };
  }
}

/** Active studios of a person: the ones they own and the ones they are staff of. */
async function findStudios(tx: Tx, email: string): Promise<StudioRef[]> {
  const result = await tx.execute(sql`
    select s.id, s.name
      from studio s
     where s.status = 'active'
       and (
         s.owner_email = ${email}
         or exists (
           select 1 from studio_staff t
            where t.studio_id = s.id and t.email = ${email}
         )
       )
     order by s.name, s.id
  `);
  return (result.rows as unknown as StudioRef[]).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

async function createSession(
  tx: Tx,
  email: string,
  studio: StudioRef,
  impersonatedBy: string | null,
): Promise<SessionResult> {
  const now = Date.now();
  const refreshToken = newRefreshToken();
  const inserted = await tx
    .insert(studioSession)
    .values({
      studioId: studio.id,
      email,
      expiresAt: new Date(now + SESSION_SLIDING_MS),
      refreshTokenHash: sha256(refreshToken),
      impersonatedBy,
    })
    .returning({ id: studioSession.id });
  const created = inserted[0];
  if (!created) throw new Error('session was not created');
  return {
    accessToken: signAccessToken(
      { sub: email, sid: created.id, api: 'studio', studioId: studio.id },
      loadEnv().ACCESS_TOKEN_SECRET,
      now,
    ),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    user: { email },
    studio: { id: studio.id, name: studio.name },
  };
}

function signedIn(session: SessionResult) {
  return { result: 'signed-in' as const, ...session };
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

interface TicketRow {
  id: string;
  email: string;
  expires_at: Date | string;
  used_at: Date | string | null;
}

interface SessionRow {
  id: string;
  studio_id: string;
  email: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  refresh_token_hash: string;
  previous_refresh_token_hash: string | null;
  rotated_at: Date | string | null;
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
