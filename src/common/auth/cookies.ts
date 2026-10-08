import type { Request, Response } from 'express';
import { ApiError } from '../errors/api-error.js';
import { SESSION_SLIDING_MS } from './tokens.js';

const MAX_AGE = Math.floor(SESSION_SLIDING_MS / 1000);

/** Name and path of the refresh-token cookie of one API. */
export interface RefreshCookie {
  name: string;
  path: string;
}

export function setRefreshCookie(
  response: Response,
  cookie: RefreshCookie,
  token: string,
) {
  response.append(
    'Set-Cookie',
    `${cookie.name}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${cookie.path}; Max-Age=${MAX_AGE}`,
  );
}

export function clearRefreshCookie(response: Response, cookie: RefreshCookie) {
  response.append(
    'Set-Cookie',
    `${cookie.name}=; HttpOnly; Secure; SameSite=Strict; Path=${cookie.path}; Max-Age=0`,
  );
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** Endpoints that use the refresh cookie require the `X-Requested-With` header. */
export function requireRequestedWith(request: Request) {
  const value = request.headers['x-requested-with'];
  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.forbidden();
  }
}
