import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { studio } from './studio.js';

/** A trainer card of one studio. Rows are not deleted in this topic. */
export const trainer = pgTable(
  'trainer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studio.id),
    name: text('name').notNull(),
    description: text('description'),
    instagram: text('instagram'),
    tiktok: text('tiktok'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('trainer_studio_id_idx').on(table.studioId),
    check(
      'trainer_name_not_blank',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) > 0`,
    ),
    check(
      'trainer_description_not_blank',
      sql`${table.description} is null or (${table.description} = btrim(${table.description}) and char_length(${table.description}) > 0)`,
    ),
    check(
      'trainer_instagram_not_blank',
      sql`${table.instagram} is null or (${table.instagram} = btrim(${table.instagram}) and char_length(${table.instagram}) > 0)`,
    ),
    check(
      'trainer_tiktok_not_blank',
      sql`${table.tiktok} is null or (${table.tiktok} = btrim(${table.tiktok}) and char_length(${table.tiktok}) > 0)`,
    ),
  ],
);

export const trainerFile = pgTable(
  'trainer_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => trainer.id),
    storagePath: text('storage_path').notNull(),
    contentType: text('content_type').notNull(),
    index: integer('index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('trainer_file_trainer_id_index_unique').on(
      table.trainerId,
      table.index,
    ),
    check('trainer_file_index_non_negative', sql`${table.index} >= 0`),
    check(
      'trainer_file_content_type',
      sql`${table.contentType} in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )`,
    ),
    check(
      'trainer_file_storage_path_not_blank',
      sql`${table.storagePath} = btrim(${table.storagePath}) and char_length(${table.storagePath}) > 0`,
    ),
  ],
);

/** A class type of one studio. Rows are not deleted in this topic. */
export const classType = pgTable(
  'class_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studio.id),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('class_type_studio_id_idx').on(table.studioId),
    check(
      'class_type_name_not_blank',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) > 0`,
    ),
    check(
      'class_type_description_not_blank',
      sql`${table.description} is null or (${table.description} = btrim(${table.description}) and char_length(${table.description}) > 0)`,
    ),
  ],
);

export const classTypeFile = pgTable(
  'class_type_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => classType.id),
    storagePath: text('storage_path').notNull(),
    contentType: text('content_type').notNull(),
    index: integer('index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('class_type_file_class_type_id_index_unique').on(
      table.classTypeId,
      table.index,
    ),
    check('class_type_file_index_non_negative', sql`${table.index} >= 0`),
    check(
      'class_type_file_content_type',
      sql`${table.contentType} in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )`,
    ),
    check(
      'class_type_file_storage_path_not_blank',
      sql`${table.storagePath} = btrim(${table.storagePath}) and char_length(${table.storagePath}) > 0`,
    ),
  ],
);
