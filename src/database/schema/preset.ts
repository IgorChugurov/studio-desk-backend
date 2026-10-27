import { sql } from 'drizzle-orm';
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** A modular organization blueprint. Organizations copy it at creation. */
export const preset = pgTable(
  'preset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    sections: jsonb('sections').notNull(),
    catalogConfig: jsonb('catalog_config').notNull(),
    scheduleConfig: jsonb('schedule_config').notNull(),
    billingConfig: jsonb('billing_config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('preset_name_unique').on(table.name),
    check(
      'preset_name_length',
      sql`char_length(${table.name}) between 2 and 100 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      'preset_description',
      sql`${table.description} is null or (
        ${table.description} = btrim(${table.description}) and char_length(${table.description}) > 0
      )`,
    ),
    check(
      'preset_sections_non_empty',
      sql`jsonb_typeof(${table.sections}) = 'array' and jsonb_array_length(${table.sections}) > 0`,
    ),
  ],
);
