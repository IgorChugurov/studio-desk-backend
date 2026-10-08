import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';

/** The interface language of a person, one row per e-mail, shared by all their studios. */
export const interfaceLanguage = pgTable(
  'interface_language',
  {
    email: text('email').primaryKey(),
    language: text('language').notNull(),
  },
  (table) => [
    check(
      'interface_language_email_lower',
      sql`${table.email} = lower(${table.email}) and position('@' in ${table.email}) > 1`,
    ),
    check(
      'interface_language_language',
      sql`${table.language} in ('en', 'sk', 'uk')`,
    ),
  ],
);
