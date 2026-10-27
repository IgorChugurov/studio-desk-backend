import { sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import type { Database } from '../../../database/database.module.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import type { Sql } from './schedule-db.js';

export async function openSchedule(
  access: StudioAccessService,
  db: Sql,
  session: StudioSessionInfo,
): Promise<{ role: string; resourceId: string | null }> {
  await access.assertSection(session, 'schedule');
  const role = await access.roleOf(session);
  if (role !== 'specialist') return { role, resourceId: null };
  const rows = await db.execute<{ resource_id: string }>(sql`
    select link.resource_id
      from organization_staff staff
      join staff_resource link on link.staff_id = staff.id
     where staff.organization_id = ${session.organizationId}
       and staff.email = ${session.email}
       and staff.role = 'specialist'
  `);
  const resourceId = rows.rows[0]?.resource_id;
  if (!resourceId) throw pageForbidden();
  return { role, resourceId };
}

export function assertWriter(role: string): void {
  if (role !== 'owner' && role !== 'administrator') throw pageForbidden();
}

export function pageForbidden(): ApiError {
  return new ApiError({
    statusCode: 403,
    code: 'FORBIDDEN',
    message: "You don't have access to this page",
  });
}

export type ScheduleDb = Database;
