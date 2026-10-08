import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';

/** Currencies a studio may use. The platform admin edits this list later. */
export const currency = pgTable(
  'currency',
  {
    code: text('code').primaryKey(),
  },
  (table) => [
    check(
      'currency_code',
      sql`${table.code} = upper(${table.code}) and char_length(${table.code}) = 3`,
    ),
  ],
);
