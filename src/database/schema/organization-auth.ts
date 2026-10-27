import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { platformAdministrator } from './platform-auth.js';
import { organization } from './organization.js';
import { resource } from './resource.js';

/**
 * A staff member of an organization (not the owner: the owner is on the organization row).
 * Managing staff comes with the roles and staff phase; sign-in only reads it.
 */
export const organizationStaff = pgTable(
  'organization_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('organization_staff_email_unique').on(
      table.organizationId,
      table.email,
    ),
    index('organization_staff_email_idx').on(table.email),
    check(
      'organization_staff_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      'organization_staff_role',
      sql`${table.role} in ('administrator', 'accountant', 'specialist')`,
    ),
  ],
);

/**
 * One catalog resource for a staff member whose role is specialist.
 * The resource's type has `person`. `staff_id` is the primary key, so a staff
 * member has at most one link. `resource_id` is unique, so a catalog resource
 * has at most one staff member. Deleting the staff member deletes this row.
 * Deleting the resource is refused while the row exists.
 */
export const staffResource = pgTable(
  'staff_resource',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    staffId: uuid('staff_id')
      .primaryKey()
      .references(() => organizationStaff.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('staff_resource_resource_id_unique').on(table.resourceId),
    index('staff_resource_organization_id_idx').on(table.organizationId),
  ],
);

/** The current sign-in code for an e-mail in the organization API. One row per address. */
export const organizationSignInCode = pgTable(
  'organization_sign_in_code',
  {
    email: text('email').primaryKey(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attemptsRemaining: smallint('attempts_remaining').notNull(),
  },
  (table) => [
    check(
      'organization_sign_in_code_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

/** One sign-in of a person into one organization. Only hashes of tokens are stored. */
export const organizationSession = pgTable(
  'organization_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    previousRefreshTokenHash: text('previous_refresh_token_hash').unique(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /** Set for a log-in-as-organization session: the platform administrator who opened it. */
    impersonatedBy: uuid('impersonated_by').references(
      () => platformAdministrator.id,
    ),
  },
  (table) => [
    index('organization_session_email_idx').on(
      table.organizationId,
      table.email,
    ),
    check(
      'organization_session_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

/**
 * A one-time, short-lived ticket that lets a person with several organizations choose
 * one after a correct code. The list of organizations is not stored: it is read again
 * when the ticket is used.
 */
export const organizationSelectionTicket = pgTable(
  'organization_selection_ticket',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'organization_selection_ticket_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);
