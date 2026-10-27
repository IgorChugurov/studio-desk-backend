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
): Promise<{ role: string; trainerId: string | null }> {
  await access.assertSection(session, 'schedule');
  const role = await access.roleOf(session);
  if (role !== 'specialist') return { role, trainerId: null };
  const rows = await db.execute<{ trainer_id: string }>(sql`
    select link.trainer_id
      from organization_staff staff
      join staff_trainer link on link.staff_id = staff.id
     where staff.organization_id = ${session.organizationId}
       and staff.email = ${session.email}
       and staff.role = 'specialist'
  `);
  const trainerId = rows.rows[0]?.trainer_id;
  if (!trainerId) throw pageForbidden();
  return { role, trainerId };
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
