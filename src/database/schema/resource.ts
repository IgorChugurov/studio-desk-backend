import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, organizationResourceType } from './organization.js';

/**
 * One catalog record: a place, a person or piece of equipment, or an offering.
 * Which columns are used depends on the cubes of `resource_type_id`.
 */
export const resource = pgTable(
  'resource',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    resourceTypeId: uuid('resource_type_id')
      .notNull()
      .references(() => organizationResourceType.id),
    name: text('name').notNull(),
    /** `ordinary` or `virtual` when the type has geography; otherwise null. */
    type: text('type'),
    address: text('address'),
    timeZone: text('time_zone'),
    /** Whole minutes, 5 to 1440 in steps of 5, when the type has duration. */
    defaultDuration: integer('default_duration'),
    description: text('description'),
    videoLink: text('video_link'),
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
    index('resource_organization_id_idx').on(table.organizationId),
    index('resource_resource_type_id_idx').on(table.resourceTypeId),
    check(
      'resource_name_not_blank',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) > 0`,
    ),
    check(
      'resource_geography',
      sql`(
        ${table.type} is null and ${table.address} is null and ${table.timeZone} is null
      ) or (
        ${table.type} = 'ordinary'
        and ${table.address} = btrim(${table.address})
        and char_length(${table.address}) > 0
        and ${table.timeZone} = btrim(${table.timeZone})
        and char_length(${table.timeZone}) > 0
      ) or (
        ${table.type} = 'virtual'
        and ${table.address} = 'Virtual place'
        and ${table.timeZone} = btrim(${table.timeZone})
        and char_length(${table.timeZone}) > 0
      )`,
    ),
    check(
      'resource_default_duration',
      sql`${table.defaultDuration} is null or (
        ${table.defaultDuration} between 5 and 1440 and ${table.defaultDuration} % 5 = 0
      )`,
    ),
    check(
      'resource_description_not_blank',
      sql`${table.description} is null or (
        ${table.description} = btrim(${table.description}) and char_length(${table.description}) > 0
      )`,
    ),
    check(
      'resource_video_link_not_blank',
      sql`${table.videoLink} is null or (
        ${table.videoLink} = btrim(${table.videoLink}) and char_length(${table.videoLink}) > 0
      )`,
    ),
    check(
      'resource_instagram_not_blank',
      sql`${table.instagram} is null or (
        ${table.instagram} = btrim(${table.instagram}) and char_length(${table.instagram}) > 0
      )`,
    ),
    check(
      'resource_tiktok_not_blank',
      sql`${table.tiktok} is null or (
        ${table.tiktok} = btrim(${table.tiktok}) and char_length(${table.tiktok}) > 0
      )`,
    ),
  ],
);

/** One image or video of a resource. The bytes live on disk. */
export const resourceFile = pgTable(
  'resource_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    /** Public address, `/files/resources/{resourceId}/{id}.ext`. */
    storagePath: text('storage_path').notNull(),
    contentType: text('content_type').notNull(),
    index: integer('index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('resource_file_resource_id_index_unique').on(
      table.resourceId,
      table.index,
    ),
    check('resource_file_index_non_negative', sql`${table.index} >= 0`),
    check(
      'resource_file_content_type',
      sql`${table.contentType} in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )`,
    ),
    check(
      'resource_file_storage_path_not_blank',
      sql`${table.storagePath} = btrim(${table.storagePath}) and char_length(${table.storagePath}) > 0`,
    ),
  ],
);

/**
 * One undirected link between two resources of different skills-enabled types.
 * The pair is stored once, with the smaller id first, and read from either side.
 */
export const resourceRelation = pgTable(
  'resource_relation',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    resourceAId: uuid('resource_a_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    resourceBId: uuid('resource_b_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceAId, table.resourceBId] }),
    index('resource_relation_organization_id_idx').on(table.organizationId),
    index('resource_relation_resource_b_id_idx').on(table.resourceBId),
    check(
      'resource_relation_ordered',
      sql`${table.resourceAId} < ${table.resourceBId}`,
    ),
  ],
);
