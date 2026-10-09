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

/** A hall of one studio. Rows are not deleted in this topic. */
export const hall = pgTable(
  'hall',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studio.id),
    name: text('name').notNull(),
    address: text('address').notNull(),
    description: text('description'),
    videoLink: text('video_link'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('hall_studio_id_idx').on(table.studioId),
    check(
      'hall_name_not_blank',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) > 0`,
    ),
    check(
      'hall_address_not_blank',
      sql`${table.address} = btrim(${table.address}) and char_length(${table.address}) > 0`,
    ),
    check(
      'hall_description_not_blank',
      sql`${table.description} is null or (
        ${table.description} = btrim(${table.description}) and char_length(${table.description}) > 0
      )`,
    ),
    check(
      'hall_video_link_not_blank',
      sql`${table.videoLink} is null or (
        ${table.videoLink} = btrim(${table.videoLink}) and char_length(${table.videoLink}) > 0
      )`,
    ),
  ],
);

/** One image or video file of a hall. The bytes live on disk. */
export const hallFile = pgTable(
  'hall_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => hall.id),
    /** Public address, `/files/halls/{hallId}/{id}.ext`. */
    storagePath: text('storage_path').notNull(),
    contentType: text('content_type').notNull(),
    index: integer('index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('hall_file_hall_id_index_unique').on(table.hallId, table.index),
    check('hall_file_index_non_negative', sql`${table.index} >= 0`),
    check(
      'hall_file_content_type',
      sql`${table.contentType} in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )`,
    ),
    check(
      'hall_file_storage_path_not_blank',
      sql`${table.storagePath} = btrim(${table.storagePath}) and char_length(${table.storagePath}) > 0`,
    ),
  ],
);
