import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const CODE_TTL_SECONDS = 600;
export const RESEND_WAIT_SECONDS = 60;
export const MAX_ATTEMPTS = 5;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SESSION_SLIDING_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
export const ROTATION_WINDOW_MS = 10 * 1000;
export const REFRESH_COOKIE = 'sd_platform_refresh';
export const REFRESH_COOKIE_PATH = '/api/platform/auth';

export function newSignInCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  api: 'platform';
}

/** Signs a 15-minute access token. The token is not stored. */
export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  now = Date.now(),
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(
    JSON.stringify({
      ...claims,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS,
    }),
  );
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function readAccessToken(
  token: string,
  secret: string,
  now = Date.now(),
): AccessTokenClaims | undefined {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return undefined;
  const expected = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!sameHash(signature, expected)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as {
      sub?: unknown;
      sid?: unknown;
      api?: unknown;
      exp?: unknown;
    };
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      payload.api !== 'platform' ||
      typeof payload.exp !== 'number' ||
      payload.exp * 1000 <= now
    ) {
      return undefined;
    }
    return { sub: payload.sub, sid: payload.sid, api: 'platform' };
  } catch {
    return undefined;
  }
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
