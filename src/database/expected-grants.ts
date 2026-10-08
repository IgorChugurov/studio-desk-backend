import type { ApiDbRole } from './db-roles.js';

export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Every table in the `public` schema and the exact rights of each API user.
 * The grants test fails on any difference with the real database.
 */
export const expectedGrants: Record<
  string,
  Record<ApiDbRole, TablePrivilege[]>
> = {
  foundation_check: {
    platform_api: ['SELECT', 'INSERT'],
    studio_api: ['SELECT'],
    public_api: [],
  },
  handoff_code: {
    platform_api: ['SELECT', 'INSERT'],
    studio_api: ['SELECT', 'UPDATE'],
    public_api: [],
  },
  platform_administrator: {
    platform_api: ['SELECT'],
    studio_api: [],
    public_api: [],
  },
  session: {
    platform_api: ['SELECT', 'INSERT', 'UPDATE'],
    studio_api: [],
    public_api: [],
  },
  sign_in_code: {
    platform_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    studio_api: [],
    public_api: [],
  },
  studio: {
    platform_api: ['SELECT', 'INSERT', 'UPDATE'],
    studio_api: ['SELECT'],
    public_api: [],
  },
  studio_selection_ticket: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  studio_session: {
    platform_api: ['SELECT', 'UPDATE'],
    studio_api: ['SELECT', 'INSERT', 'UPDATE'],
    public_api: [],
  },
  studio_sign_in_code: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  studio_staff: {
    platform_api: ['SELECT'],
    studio_api: ['SELECT'],
    public_api: [],
  },
};
