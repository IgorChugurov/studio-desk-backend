import type { Env } from '../config/env.js';

export const API_DB_ROLES = [
  'platform_api',
  'studio_api',
  'public_api',
] as const;
export type ApiDbRole = (typeof API_DB_ROLES)[number];

export const OWNER_DB_ROLE = 'studio_desk_owner';

export function dbPassword(env: Env, role: ApiDbRole | typeof OWNER_DB_ROLE) {
  switch (role) {
    case OWNER_DB_ROLE:
      return env.DB_OWNER_PASSWORD;
    case 'platform_api':
      return env.DB_PLATFORM_API_PASSWORD;
    case 'studio_api':
      return env.DB_STUDIO_API_PASSWORD;
    case 'public_api':
      return env.DB_PUBLIC_API_PASSWORD;
  }
}

export function connectionConfig(
  env: Env,
  role: ApiDbRole | typeof OWNER_DB_ROLE,
) {
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: role,
    password: dbPassword(env, role),
  };
}
