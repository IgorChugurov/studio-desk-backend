import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { studio } from './studio.js';

/** The single platform administrator. The row itself is not inserted by a migration. */
export const platformAdministrator = pgTable(
  'platform_administrator',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('platform_administrator_one_row').on(sql`true`),
    check(
      'platform_administrator_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

/** The current sign-in code for an e-mail. One row per address. */
export const signInCode = pgTable(
  'sign_in_code',
  {
    email: text('email').primaryKey(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attemptsRemaining: smallint('attempts_remaining').notNull(),
  },
  (table) => [
    check(
      'sign_in_code_email_lower',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

/** One sign-in. Shared by the platform API and, later, the studio API. */
export const authSession = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platformAdministratorId: uuid('platform_administrator_id')
      .notNull()
      .references(() => platformAdministrator.id),
    api: text('api').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    previousRefreshTokenHash: text('previous_refresh_token_hash').unique(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => [
    check('session_api', sql`${table.api} in ('platform', 'studio')`),
  ],
);

/**
 * A one-time code that hands a platform administrator over to a studio admin
 * (log in as studio). Only the hash is stored.
 */
export const handoffCode = pgTable('handoff_code', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull().unique(),
  studioId: uuid('studio_id')
    .notNull()
    .references(() => studio.id),
  platformAdministratorId: uuid('platform_administrator_id')
    .notNull()
    .references(() => platformAdministrator.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
