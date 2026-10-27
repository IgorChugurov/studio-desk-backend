import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { currency } from './currency.js';
import { preset } from './preset.js';

const subdomainPattern = '^[a-z][a-z0-9-]{1,18}[a-z0-9]$';
const domainPattern =
  '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';

/** An organization. The owner is an e-mail on this row, not a separate table. */
export const organization = pgTable(
  'organization',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    subdomain: text('subdomain').notNull(),
    customDomain: text('custom_domain'),
    ownerEmail: text('owner_email').notNull(),
    /** Language of the organization for clients. Not the person's interface language. */
    language: text('language').notNull().default('en'),
    country: text('country').notNull().default('SK'),
    currency: text('currency')
      .notNull()
      .default('EUR')
      .references(() => currency.code),
    timeZone: text('time_zone').notNull().default('Europe/Bratislava'),
    presetId: uuid('preset_id').references(() => preset.id, {
      onDelete: 'set null',
    }),
    presetName: text('preset_name').notNull(),
    scheduleConfig: jsonb('schedule_config').notNull(),
    billingConfig: jsonb('billing_config').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('organization_subdomain_unique').on(table.subdomain),
    index('organization_owner_email_idx').on(table.ownerEmail),
    uniqueIndex('organization_custom_domain_unique')
      .on(table.customDomain)
      .where(sql`${table.customDomain} is not null`),
    check(
      'organization_name_length',
      sql`char_length(${table.name}) between 2 and 100 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      'organization_subdomain_format',
      sql`${table.subdomain} = lower(${table.subdomain}) and ${table.subdomain} ~ ${subdomainPattern}`,
    ),
    check(
      'organization_custom_domain_format',
      sql`${table.customDomain} is null or (
        ${table.customDomain} = lower(${table.customDomain})
        and char_length(${table.customDomain}) between 1 and 253
        and ${table.customDomain} !~ '://'
        and ${table.customDomain} ~ ${domainPattern}
        and ${table.customDomain} <> 'studio-desk.axondigital.xyz'
        and ${table.customDomain} !~ '\\.studio-desk\\.axondigital\\.xyz$'
      )`,
    ),
    check(
      'organization_owner_email_lower',
      sql`${table.ownerEmail} = lower(${table.ownerEmail}) and position('@' in ${table.ownerEmail}) > 1`,
    ),
    check(
      'organization_status',
      sql`${table.status} in ('active', 'deactivated')`,
    ),
    check(
      'organization_language',
      sql`${table.language} in ('en', 'sk', 'uk')`,
    ),
    check(
      'organization_country',
      sql`${table.country} = upper(${table.country}) and char_length(${table.country}) = 2`,
    ),
    check(
      'organization_time_zone',
      sql`${table.timeZone} = btrim(${table.timeZone}) and char_length(${table.timeZone}) > 0`,
    ),
    check(
      'organization_preset_name_length',
      sql`char_length(${table.presetName}) between 2 and 100 and ${table.presetName} = btrim(${table.presetName})`,
    ),
  ],
);

/** Sections enabled for one organization. A row means the section is on. */
export const organizationSection = pgTable(
  'organization_section',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    section: text('section').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.section] }),
    check(
      'organization_section_section',
      sql`${table.section} in (
        'schedule', 'catalogs', 'clients', 'subscriptions',
        'accounting', 'organization-settings', 'staff'
      )`,
    ),
  ],
);

/** One catalog resource type copied from a preset, then owned by the organization. */
export const organizationResourceType = pgTable(
  'organization_resource_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    sortOrder: integer('sort_order').notNull(),
    role: text('role').notNull(),
    labels: jsonb('labels').notNull(),
    geography: boolean('geography').notNull(),
    duration: boolean('duration').notNull(),
    showcase: boolean('showcase').notNull(),
    person: boolean('person').notNull(),
    skills: boolean('skills').notNull(),
    required: boolean('required').notNull(),
    multiple: boolean('multiple').notNull(),
    conflictMode: text('conflict_mode').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('organization_resource_type_sort_unique').on(
      table.organizationId,
      table.sortOrder,
    ),
    index('organization_resource_type_organization_id_idx').on(
      table.organizationId,
    ),
    check(
      'organization_resource_type_role',
      sql`${table.role} in ('place', 'resource', 'offering')`,
    ),
    check(
      'organization_resource_type_conflict_mode',
      sql`${table.conflictMode} in ('strict', 'warning', 'none')`,
    ),
    check(
      'organization_resource_type_sort_order',
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);
