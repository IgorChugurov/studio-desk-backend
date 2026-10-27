import type { ApiDbRole } from './db-roles.js';

export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Every table in the `public` schema and the exact rights of each API user.
 * The grants test fails on any difference with the real database.
 * The PostgreSQL login for the organization API stays `studio_api`
 * (see docker/postgres/init/01-init.sh).
 */
export const expectedGrants: Record<
  string,
  Record<ApiDbRole, TablePrivilege[]>
> = {
  class_type: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE'],
    public_api: [],
  },
  class_type_file: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  currency: {
    platform_api: [],
    studio_api: ['SELECT'],
    public_api: [],
  },
  foundation_check: {
    platform_api: ['SELECT', 'INSERT'],
    studio_api: ['SELECT'],
    public_api: [],
  },
  hall: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE'],
    public_api: [],
  },
  hall_file: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  handoff_code: {
    platform_api: ['SELECT', 'INSERT'],
    studio_api: ['SELECT', 'UPDATE'],
    public_api: [],
  },
  interface_language: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE'],
    public_api: [],
  },
  organization: {
    platform_api: ['SELECT', 'INSERT', 'UPDATE'],
    studio_api: ['SELECT'],
    public_api: [],
  },
  organization_resource_type: {
    platform_api: ['SELECT', 'INSERT'],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  organization_section: {
    platform_api: ['SELECT', 'INSERT', 'DELETE'],
    studio_api: ['SELECT'],
    public_api: [],
  },
  organization_selection_ticket: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  organization_session: {
    platform_api: ['SELECT', 'UPDATE'],
    studio_api: ['SELECT', 'INSERT', 'UPDATE'],
    public_api: [],
  },
  organization_sign_in_code: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  organization_staff: {
    platform_api: ['SELECT'],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  platform_administrator: {
    platform_api: ['SELECT'],
    studio_api: [],
    public_api: [],
  },
  preset: {
    platform_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    studio_api: [],
    public_api: [],
  },
  role_section: {
    platform_api: [],
    studio_api: ['SELECT'],
    public_api: [],
  },
  scheduled_class: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  scheduled_class_trainer: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
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
  staff_trainer: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  trainer: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE'],
    public_api: [],
  },
  trainer_class_type: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'DELETE'],
    public_api: [],
  },
  trainer_file: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  week_template: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  week_template_row: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
  week_template_row_trainer: {
    platform_api: [],
    studio_api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    public_api: [],
  },
};
