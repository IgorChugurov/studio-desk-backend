import type { RefreshCookie } from '../../../common/auth/cookies.js';

export const STUDIO_COOKIE: RefreshCookie = {
  name: 'sd_studio_refresh',
  path: '/api/studio/auth',
};

/** Life of the one-time ticket for choosing a studio after a correct code. */
export const SELECTION_TICKET_TTL_SECONDS = 300;
