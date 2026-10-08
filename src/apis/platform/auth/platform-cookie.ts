import type { RefreshCookie } from '../../../common/auth/cookies.js';

export const PLATFORM_COOKIE: RefreshCookie = {
  name: 'sd_platform_refresh',
  path: '/api/platform/auth',
};
