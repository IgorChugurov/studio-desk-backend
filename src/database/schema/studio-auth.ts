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
import { studio } from './studio.js';

/**
 * A staff member of a studio (not the owner: the owner is on the studio row).
 * Managing staff comes with the roles and staff phase; sign-in only reads it.
 */
export const studioStaff = pgTable(
  'studio_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studio.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('studio_staff_studio_email_unique').on(
      table.studioId,
      table.email,
    ),
    index('studio_staff_email_idx').on(table.email),
    check(
      'studio_staff_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      'studio_staff_role',
      sql`${table.role} in ('administrator', 'accountant')`,
    ),
  ],
);

/** The current sign-in code for an e-mail in the studio API. One row per address. */
export const studioSignInCode = pgTable(
  'studio_sign_in_code',
  {
    email: text('email').primaryKey(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attemptsRemaining: smallint('attempts_remaining').notNull(),
  },
  (table) => [
    check(
      'studio_sign_in_code_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

/** One sign-in of a person into one studio. Only hashes of tokens are stored. */
export const studioSession = pgTable(
  'studio_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studio.id),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    previousRefreshTokenHash: text('previous_refresh_token_hash').unique(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /** Set for a log-in-as-studio session: the platform administrator who opened it. */
    impersonatedBy: uuid('impersonated_by').references(
      () => platformAdministrator.id,
    ),
  },
  (table) => [
    index('studio_session_studio_email_idx').on(table.studioId, table.email),
    check(
      'studio_session_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

/**
 * A one-time, short-lived ticket that lets a person with several studios choose
 * one after a correct code. The list of studios is not stored: it is read again
 * when the ticket is used.
 */
export const studioSelectionTicket = pgTable(
  'studio_selection_ticket',
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
      'studio_selection_ticket_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);
