import type { Response } from 'express';
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  SESSION_SLIDING_MS,
} from './tokens.js';

const MAX_AGE = Math.floor(SESSION_SLIDING_MS / 1000);

export function setRefreshCookie(response: Response, token: string) {
  response.append(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=${MAX_AGE}`,
  );
}

export function clearRefreshCookie(response: Response) {
  response.append(
    'Set-Cookie',
    `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=0`,
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
