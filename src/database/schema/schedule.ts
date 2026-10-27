import { sql } from 'drizzle-orm';
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

/** Real interval `[start, end)`. Empty when the class is cancelled. */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

const weekday = sql`'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'`;
const audience = sql`'group', 'one_person'`;
const format = sql`'offline', 'offline_and_online', 'online_only'`;

/** A week template. Editing it does not change classes already created. */
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
    weekday: text('weekday').notNull(),
    startTime: time('start_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => resource.id),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => resource.id),
    audience: text('audience').notNull(),
    format: text('format').notNull(),
    places: integer('places'),
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
    check('week_template_row_weekday', sql`${table.weekday} in (${weekday})`),
    check(
      'week_template_row_audience',
      sql`${table.audience} in (${audience})`,
    ),
    check('week_template_row_format', sql`${table.format} in (${format})`),
    check(
      'week_template_row_places',
      sql`${table.places} is null or ${table.places} >= 1`,
    ),
    check(
      'week_template_row_duration',
      sql`${table.durationMinutes} between 5 and 240 and ${table.durationMinutes} % 5 = 0`,
    ),
    check(
      'week_template_row_clock',
      sql`extract(second from ${table.startTime}) = 0
        and extract(minute from ${table.startTime})::int % 5 = 0
        and (extract(hour from ${table.startTime}) * 60 + extract(minute from ${table.startTime}) + ${table.durationMinutes}) <= 1440`,
    ),
  ],
);

export const weekTemplateRowTrainer = pgTable(
  'week_template_row_trainer',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    rowId: uuid('row_id')
      .notNull()
      .references(() => weekTemplateRow.id, { onDelete: 'cascade' }),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => resource.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.rowId, table.trainerId] }),
    index('week_template_row_trainer_organization_id_idx').on(
      table.organizationId,
    ),
  ],
);

/**
 * One class. `date` and `start_time` are the hall's clock.
 * `starts_at` and `ends_at` are that moment in the hall's time zone.
 */
export const scheduledClass = pgTable(
  'scheduled_class',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => resource.id),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => resource.id),
    date: date('date').notNull(),
    startTime: time('start_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    audience: text('audience').notNull(),
    format: text('format').notNull(),
    places: integer('places'),
    cancelled: boolean('cancelled').notNull().default(false),
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
    index('scheduled_class_organization_id_idx').on(table.organizationId),
    index('scheduled_class_hall_date_idx').on(table.hallId, table.date),
    check('scheduled_class_audience', sql`${table.audience} in (${audience})`),
    check('scheduled_class_format', sql`${table.format} in (${format})`),
    check(
      'scheduled_class_places',
      sql`${table.places} is null or ${table.places} >= 1`,
    ),
    check(
      'scheduled_class_ends_after_start',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      'scheduled_class_duration',
      sql`${table.durationMinutes} between 5 and 240 and ${table.durationMinutes} % 5 = 0`,
    ),
    check(
      'scheduled_class_clock',
      sql`extract(second from ${table.startTime}) = 0
        and extract(minute from ${table.startTime})::int % 5 = 0
        and (extract(hour from ${table.startTime}) * 60 + extract(minute from ${table.startTime}) + ${table.durationMinutes}) <= 1440`,
    ),
  ],
);

export const scheduledClassTrainer = pgTable(
  'scheduled_class_trainer',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    classId: uuid('class_id')
      .notNull()
      .references(() => scheduledClass.id, { onDelete: 'cascade' }),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => resource.id),
    during: tstzrange('during'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.classId, table.trainerId] }),
    index('scheduled_class_trainer_organization_id_idx').on(
      table.organizationId,
    ),
    index('scheduled_class_trainer_trainer_id_idx').on(table.trainerId),
  ],
);
