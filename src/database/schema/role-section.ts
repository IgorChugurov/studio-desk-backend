import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Which sections a role may open. A row means yes. Filled once by migration.
 * There is no screen to edit it. «Only my own» inside a section comes later.
 */
export const roleSection = pgTable(
  'role_section',
  {
    role: text('role').notNull(),
    section: text('section').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.role, table.section] }),
    check(
      'role_section_role',
      sql`${table.role} in ('owner', 'administrator', 'accountant', 'trainer')`,
    ),
    check(
      'role_section_section',
      sql`${table.section} in (
        'schedule', 'catalogs', 'clients', 'subscriptions',
        'accounting', 'studio-settings', 'staff'
      )`,
    ),
  ],
);
