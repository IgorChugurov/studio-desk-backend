import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Service table that exercises the table-rights mechanism (grants test and
 * API isolation test). Holds no product data.
 */
export const foundationCheck = pgTable('foundation_check', {
  id: uuid('id').primaryKey().defaultRandom(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
