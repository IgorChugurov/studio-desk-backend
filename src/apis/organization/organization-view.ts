import { asc, eq } from 'drizzle-orm';
import type {
  BillingConfig,
  OrganizationResourceTypeView,
  ScheduleConfig,
} from '../../common/organization-config.js';
import type { Database } from '../../database/database.module.js';
import {
  organization,
  organizationResourceType,
} from '../../database/schema/index.js';

export async function readOrganizationConfig(
  db: Database,
  organizationId: string,
) {
  const rows = await db
    .select({
      scheduleConfig: organization.scheduleConfig,
      billingConfig: organization.billingConfig,
    })
    .from(organization)
    .where(eq(organization.id, organizationId));
  const current = rows[0];
  const types = await db
    .select()
    .from(organizationResourceType)
    .where(eq(organizationResourceType.organizationId, organizationId))
    .orderBy(asc(organizationResourceType.sortOrder));
  return {
    catalogConfig: {
      resourceTypes: types.map(toResourceType),
    },
    scheduleConfig: current?.scheduleConfig as ScheduleConfig,
    billingConfig: current?.billingConfig as BillingConfig,
  };
}

function toResourceType(
  row: typeof organizationResourceType.$inferSelect,
): OrganizationResourceTypeView {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    role: row.role as OrganizationResourceTypeView['role'],
    labels: row.labels as OrganizationResourceTypeView['labels'],
    geography: row.geography,
    duration: row.duration,
    showcase: row.showcase,
    person: row.person,
    skills: row.skills,
    required: row.required,
    multiple: row.multiple,
    conflictMode:
      row.conflictMode as OrganizationResourceTypeView['conflictMode'],
  };
}
