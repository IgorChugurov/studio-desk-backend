import { type SQLWrapper, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization } from './organization.js';
import { resource } from './resource.js';

/** Half-open instant range `[start, end)`. Null when the slot occupies nothing. */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

const weekday = sql`'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'`;
const kind = sql`'service', 'block'`;
const audience = sql`'group', 'one_person'`;
const format = sql`'offline', 'offline_and_online', 'online_only'`;
const status = sql`'planned', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'`;
const linkRole = sql`'place', 'resource', 'offering'`;

const duration = (minutes: SQLWrapper) =>
  sql`${minutes} between 5 and 1440 and ${minutes} % 5 = 0`;

const clock = (start: SQLWrapper, minutes: SQLWrapper) =>
  sql`extract(second from ${start}) = 0
    and extract(minute from ${start})::int % 5 = 0
    and (extract(hour from ${start}) * 60 + extract(minute from ${start}) + ${minutes}) <= 1440`;

const shape = (
  slotKind: SQLWrapper,
  slotAudience: SQLWrapper,
  slotFormat: SQLWrapper,
  slotPlaces: SQLWrapper,
  slotNote: SQLWrapper,
  slotBlocksAll: SQLWrapper,
) =>
  sql`(
    ${slotKind} = 'service'
    and ${slotAudience} is not null
    and ${slotFormat} is not null
    and ${slotNote} is null
    and ${slotBlocksAll} = false
  ) or (
    ${slotKind} = 'block'
    and ${slotAudience} is null
    and ${slotFormat} is null
    and ${slotPlaces} is null
  )`;

/** A week template. Editing it does not change slots already created. */
export const weekTemplate = pgTable(
  'week_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('week_template_organization_name_unique').on(
      table.organizationId,
      table.name,
    ),
    index('week_template_organization_id_idx').on(table.organizationId),
    check(
      'week_template_name_not_blank',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) > 0`,
    ),
  ],
);

/** One row of a template. Times are clock digits, not a real moment. */
export const weekTemplateRow = pgTable(
  'week_template_row',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => weekTemplate.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    weekday: text('weekday').notNull(),
    startTime: time('start_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    placeResourceId: uuid('place_resource_id')
      .notNull()
      .references(() => resource.id),
    audience: text('audience'),
    format: text('format'),
    places: integer('places'),
    note: text('note'),
    blocksAll: boolean('blocks_all').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('week_template_row_template_id_idx').on(table.templateId),
    index('week_template_row_organization_id_idx').on(table.organizationId),
    check('week_template_row_kind', sql`${table.kind} in (${kind})`),
    check('week_template_row_weekday', sql`${table.weekday} in (${weekday})`),
    check(
      'week_template_row_audience',
      sql`${table.audience} is null or ${table.audience} in (${audience})`,
    ),
    check(
      'week_template_row_format',
      sql`${table.format} is null or ${table.format} in (${format})`,
    ),
    check(
      'week_template_row_places',
      sql`${table.places} is null or ${table.places} >= 1`,
    ),
    check(
      'week_template_row_note',
      sql`${table.note} is null or (
        ${table.note} = btrim(${table.note}) and char_length(${table.note}) > 0
      )`,
    ),
    check('week_template_row_duration', duration(table.durationMinutes)),
    check(
      'week_template_row_clock',
      clock(table.startTime, table.durationMinutes),
    ),
    check(
      'week_template_row_shape',
      shape(
        table.kind,
        table.audience,
        table.format,
        table.places,
        table.note,
        table.blocksAll,
      ),
    ),
  ],
);

/** Non-place resources of a template row (`resource` and `offering`). */
export const weekTemplateRowResource = pgTable(
  'week_template_row_resource',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    rowId: uuid('row_id')
      .notNull()
      .references(() => weekTemplateRow.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.rowId, table.resourceId] }),
    index('week_template_row_resource_organization_id_idx').on(
      table.organizationId,
    ),
  ],
);

/**
 * One schedule slot. `date` and `start_time` are the place resource's clock.
 * `starts_at` and `ends_at` are that moment in the place's time zone.
 * The overlap exclusion lives on `schedule_slot_resource` in the migration,
 * because one partial GiST constraint covers every strict resource.
 */
export const scheduleSlot = pgTable(
  'schedule_slot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    kind: text('kind').notNull(),
    placeResourceId: uuid('place_resource_id')
      .notNull()
      .references(() => resource.id),
    date: date('date').notNull(),
    startTime: time('start_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    audience: text('audience'),
    format: text('format'),
    places: integer('places'),
    note: text('note'),
    blocksAll: boolean('blocks_all').notNull().default(false),
    status: text('status').notNull().default('planned'),
    occupiesResources: boolean('occupies_resources').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('schedule_slot_organization_id_idx').on(table.organizationId),
    index('schedule_slot_place_date_idx').on(table.placeResourceId, table.date),
    check('schedule_slot_kind', sql`${table.kind} in (${kind})`),
    check('schedule_slot_status', sql`${table.status} in (${status})`),
    check(
      'schedule_slot_audience',
      sql`${table.audience} is null or ${table.audience} in (${audience})`,
    ),
    check(
      'schedule_slot_format',
      sql`${table.format} is null or ${table.format} in (${format})`,
    ),
    check(
      'schedule_slot_places',
      sql`${table.places} is null or ${table.places} >= 1`,
    ),
    check(
      'schedule_slot_note',
      sql`${table.note} is null or (
        ${table.note} = btrim(${table.note}) and char_length(${table.note}) > 0
      )`,
    ),
    check(
      'schedule_slot_ends_after_start',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check('schedule_slot_duration', duration(table.durationMinutes)),
    check('schedule_slot_clock', clock(table.startTime, table.durationMinutes)),
    check(
      'schedule_slot_shape',
      shape(
        table.kind,
        table.audience,
        table.format,
        table.places,
        table.note,
        table.blocksAll,
      ),
    ),
    check(
      'schedule_slot_occupies',
      sql`(
        ${table.status} in ('planned', 'confirmed', 'in_progress', 'completed')
        and ${table.occupiesResources}
      ) or (
        ${table.status} in ('cancelled', 'no_show')
        and not ${table.occupiesResources}
      )`,
    ),
  ],
);

/** Place plus every other resource of a slot. Strict rows carry `during`. */
export const scheduleSlotResource = pgTable(
  'schedule_slot_resource',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => scheduleSlot.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id),
    role: text('role').notNull(),
    enforceNoOverlap: boolean('enforce_no_overlap').notNull(),
    during: tstzrange('during'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.slotId, table.resourceId] }),
    index('schedule_slot_resource_organization_id_idx').on(
      table.organizationId,
    ),
    index('schedule_slot_resource_resource_id_idx').on(table.resourceId),
    check('schedule_slot_resource_role', sql`${table.role} in (${linkRole})`),
  ],
);
