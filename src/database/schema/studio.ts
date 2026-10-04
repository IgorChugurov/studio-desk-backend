import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const subdomainPattern = '^[a-z][a-z0-9-]{1,18}[a-z0-9]$';
const domainPattern =
  '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';

/** A studio. The owner is an e-mail on this row, not a separate table. */
export const studio = pgTable(
  'studio',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    subdomain: text('subdomain').notNull(),
    customDomain: text('custom_domain'),
    ownerEmail: text('owner_email').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('studio_subdomain_unique').on(table.subdomain),
    uniqueIndex('studio_custom_domain_unique')
      .on(table.customDomain)
      .where(sql`${table.customDomain} is not null`),
    check(
      'studio_name_length',
      sql`char_length(${table.name}) between 2 and 100 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      'studio_subdomain_format',
      sql`${table.subdomain} = lower(${table.subdomain}) and ${table.subdomain} ~ ${subdomainPattern}`,
    ),
    check(
      'studio_custom_domain_format',
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
      'studio_owner_email_lower',
      sql`${table.ownerEmail} = lower(${table.ownerEmail}) and position('@' in ${table.ownerEmail}) > 1`,
    ),
    check('studio_status', sql`${table.status} in ('active', 'deactivated')`),
  ],
);
