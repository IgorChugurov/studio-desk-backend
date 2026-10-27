import { sql } from 'drizzle-orm';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import type { Database } from '../../../database/database.module.js';
import { endClock, hallBusyText, trainerBusyText } from './schedule-time.js';

export type Sql = Pick<Database, 'execute'>;

export interface ClassFields {
  hallId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  trainerIds: string[];
  classTypeId: string;
  audience: 'group' | 'one_person';
  format: 'offline' | 'offline_and_online' | 'online_only';
  places: number | null;
}

export interface ClassView extends ClassFields {
  id: string;
  cancelled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface BusyRow extends Record<string, unknown> {
  class_id: string;
  class_type_name: string;
  hall_name: string;
  trainer_name: string | null;
  start_time: string;
  duration_minutes: number;
  kind: 'hall' | 'trainer';
}

export async function studioToday(
  db: Sql,
  organizationId: string,
): Promise<string> {
  const rows = await db.execute<{ today: string }>(sql`
    select to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as today
      from organization
     where id = ${organizationId}
  `);
  const today = rows.rows[0]?.today;
  if (!today) throw ApiError.notFound('Studio not found');
  return today;
}

export async function hallOf(
  db: Sql,
  organizationId: string,
  hallId: string,
): Promise<{
  id: string;
  type: 'ordinary' | 'virtual';
  name: string;
  timeZone: string;
}> {
  const rows = await db.execute<{
    id: string;
    type: 'ordinary' | 'virtual';
    name: string;
    time_zone: string;
  }>(sql`
    select id, type, name, time_zone
      from resource
     where id = ${hallId} and organization_id = ${organizationId}
       and type is not null
  `);
  const row = rows.rows[0];
  if (!row) {
    throw ApiError.validation([
      {
        code: FieldErrorCode.INVALID_VALUE,
        field: 'hallId',
        message: 'Choose a hall of this studio',
      },
    ]);
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    timeZone: row.time_zone,
  };
}

export function placeErrors(
  hallType: 'ordinary' | 'virtual',
  input: Pick<ClassFields, 'format' | 'audience' | 'places'>,
): { code: string; field: string; message: string }[] {
  const errors: { code: string; field: string; message: string }[] = [];
  if (hallType === 'virtual' && input.format !== 'online_only') {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'format',
      message: 'A virtual hall is online only',
    });
  }
  const placesForbidden =
    hallType === 'virtual' ||
    input.audience === 'one_person' ||
    input.format === 'online_only';
  if (placesForbidden && input.places !== null) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'places',
      message: 'Enter the number of places',
    });
  }
  if (!placesForbidden && input.places === null) {
    errors.push({
      code: FieldErrorCode.REQUIRED,
      field: 'places',
      message: 'Enter the number of places',
    });
  }
  if (!placesForbidden && input.places !== null && input.places < 1) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'places',
      message: 'Enter the number of places',
    });
  }
  return errors;
}

export async function assertClassRefs(
  db: Sql,
  organizationId: string,
  input: Pick<ClassFields, 'classTypeId' | 'trainerIds'>,
): Promise<void> {
  const types = await db.execute<{ id: string }>(sql`
    select id from resource
     where id = ${input.classTypeId} and organization_id = ${organizationId}
       and default_duration is not null
  `);
  const trainers = await db.execute<{ id: string }>(sql`
    select id from resource
     where organization_id = ${organizationId}
       and type is null
       and default_duration is null
       and id in (${sql.join(
         input.trainerIds.map((id) => sql`${id}`),
         sql`, `,
       )})
  `);
  const errors = [];
  if (!types.rows[0]) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'classTypeId',
      message: 'Choose a class type of this studio',
    });
  }
  if (trainers.rows.length !== input.trainerIds.length) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'trainerIds',
      message: 'Choose trainers of this studio',
    });
  }
  if (errors.length > 0) throw ApiError.validation(errors);
}

export async function isPast(
  db: Sql,
  timeZone: string,
  date: string,
  startTime: string,
): Promise<boolean> {
  const rows = await db.execute<{ past: boolean }>(sql`
    select ((${date}::date + ${startTime}::time) at time zone ${timeZone}) <= now() as past
  `);
  return rows.rows[0]?.past ?? false;
}

export async function insertClass(
  db: Sql,
  organizationId: string,
  input: ClassFields,
  timeZone: string,
): Promise<string> {
  await assertFree(db, input, timeZone, null);
  await db.execute(sql`savepoint class_write`);
  try {
    const id = crypto.randomUUID();
    await db.execute(sql`
      insert into scheduled_class (
        id, organization_id, hall_id, class_type_id, date, start_time, duration_minutes,
        audience, format, places, cancelled, starts_at, ends_at
      ) values (
        ${id}, ${organizationId}, ${input.hallId}, ${input.classTypeId},
        ${input.date}::date, ${input.startTime}::time, ${input.durationMinutes},
        ${input.audience}, ${input.format}, ${input.places}, false,
        (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
        ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
          + (${String(input.durationMinutes)} || ' minutes')::interval
      )
    `);
    await writeTrainers(db, organizationId, id, input.trainerIds, false);
    await db.execute(sql`release savepoint class_write`);
    return id;
  } catch (error) {
    await db.execute(sql`rollback to savepoint class_write`);
    throw await busyFrom(db, error, input, timeZone, null);
  }
}

export async function rewriteClass(
  db: Sql,
  organizationId: string,
  classId: string,
  input: ClassFields,
  timeZone: string,
): Promise<void> {
  await assertFree(db, input, timeZone, classId);
  await db.execute(sql`savepoint class_write`);
  try {
    await db.execute(sql`
      update scheduled_class
         set hall_id = ${input.hallId},
             class_type_id = ${input.classTypeId},
             date = ${input.date}::date,
             start_time = ${input.startTime}::time,
             duration_minutes = ${input.durationMinutes},
             audience = ${input.audience},
             format = ${input.format},
             places = ${input.places},
             starts_at = (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
             ends_at = ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
               + (${String(input.durationMinutes)} || ' minutes')::interval,
             updated_at = now()
       where id = ${classId} and organization_id = ${organizationId}
    `);
    await db.execute(sql`
      delete from scheduled_class_trainer where class_id = ${classId}
    `);
    await writeTrainers(db, organizationId, classId, input.trainerIds, false);
    await db.execute(sql`release savepoint class_write`);
  } catch (error) {
    await db.execute(sql`rollback to savepoint class_write`);
    throw await busyFrom(db, error, input, timeZone, classId);
  }
}

export async function setCancelled(
  db: Sql,
  classId: string,
  cancelled: boolean,
): Promise<void> {
  if (!cancelled) {
    const current = await readClassRow(db, classId);
    if (!current) throw ApiError.notFound('Class not found');
    await assertFree(db, current, current.timeZone, classId);
  }
  await db.execute(sql`savepoint class_write`);
  try {
    await db.execute(sql`
      update scheduled_class
         set cancelled = ${cancelled}, updated_at = now()
       where id = ${classId}
    `);
    if (cancelled) {
      await db.execute(sql`
        update scheduled_class_trainer set during = null where class_id = ${classId}
      `);
    } else {
      await db.execute(sql`
        update scheduled_class_trainer t
           set during = tstzrange(c.starts_at, c.ends_at, '[)')
          from scheduled_class c
         where t.class_id = c.id and c.id = ${classId}
      `);
    }
    await db.execute(sql`release savepoint class_write`);
  } catch (error) {
    await db.execute(sql`rollback to savepoint class_write`);
    const current = await readClassRow(db, classId);
    if (!current) throw error;
    throw await busyFrom(db, error, current, current.timeZone, classId);
  }
}

async function writeTrainers(
  db: Sql,
  organizationId: string,
  classId: string,
  trainerIds: string[],
  cancelled: boolean,
): Promise<void> {
  for (let index = 0; index < trainerIds.length; index += 1) {
    const trainerId = trainerIds[index]!;
    await db.execute(sql`
      insert into scheduled_class_trainer (
        organization_id, class_id, trainer_id, during, created_at
      )
      select ${organizationId}, ${classId}, ${trainerId},
             case when ${cancelled} then null
                  else tstzrange(starts_at, ends_at, '[)') end,
             now() + (${String(index)} || ' milliseconds')::interval
        from scheduled_class
       where id = ${classId}
    `);
  }
}

async function assertFree(
  db: Sql,
  input: ClassFields,
  timeZone: string,
  exceptId: string | null,
): Promise<void> {
  const busy = await findBusy(db, input, timeZone, exceptId);
  if (busy) throw busyError(busy);
}

export async function findBusy(
  db: Sql,
  input: ClassFields,
  timeZone: string,
  exceptId: string | null,
): Promise<BusyRow | undefined> {
  const except = exceptId ?? '00000000-0000-0000-0000-000000000000';
  const range = sql`tstzrange(
    (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
    ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
      + (${String(input.durationMinutes)} || ' minutes')::interval,
    '[)'
  )`;
  const hallRows = await db.execute<BusyRow>(sql`
    select c.id as class_id, ct.name as class_type_name, h.name as hall_name,
           null::text as trainer_name,
           to_char(c.start_time, 'HH24:MI') as start_time,
           c.duration_minutes, 'hall'::text as kind
      from scheduled_class c
      join resource ct on ct.id = c.class_type_id
      join resource h on h.id = c.hall_id
     where c.hall_id = ${input.hallId}
       and c.id <> ${except}
       and not c.cancelled
       and tstzrange(c.starts_at, c.ends_at, '[)') && ${range}
     order by c.date, c.start_time, c.id
     limit 1
  `);
  if (hallRows.rows[0]) return hallRows.rows[0];
  const trainerRows = await db.execute<BusyRow>(sql`
    select c.id as class_id, ct.name as class_type_name, h.name as hall_name,
           tr.name as trainer_name,
           to_char(c.start_time, 'HH24:MI') as start_time,
           c.duration_minutes, 'trainer'::text as kind
      from scheduled_class_trainer t
      join scheduled_class c on c.id = t.class_id
      join resource ct on ct.id = c.class_type_id
      join resource h on h.id = c.hall_id
      join resource tr on tr.id = t.trainer_id
     where t.trainer_id in (${sql.join(
       input.trainerIds.map((id) => sql`${id}`),
       sql`, `,
     )})
       and c.id <> ${except}
       and not c.cancelled
       and t.during && ${range}
     order by c.date, c.start_time, c.id
     limit 1
  `);
  return trainerRows.rows[0];
}

function busyError(row: BusyRow): ApiError {
  const start = row.start_time.slice(0, 5);
  const end = endClock(start, row.duration_minutes);
  if (row.kind === 'hall') {
    return new ApiError({
      statusCode: 409,
      code: 'HALL_BUSY',
      message: hallBusyText(row.class_type_name, start, end),
      conflict: {
        classTypeName: row.class_type_name,
        start,
        end,
        classId: row.class_id,
      },
    });
  }
  return new ApiError({
    statusCode: 409,
    code: 'TRAINER_BUSY',
    message: trainerBusyText(row.trainer_name ?? '', row.hall_name, start, end),
    conflict: {
      trainerName: row.trainer_name ?? '',
      hallName: row.hall_name,
      start,
      end,
      classId: row.class_id,
    },
  });
}

async function busyFrom(
  db: Sql,
  error: unknown,
  input: ClassFields,
  timeZone: string,
  exceptId: string | null,
): Promise<unknown> {
  if (!isExclusion(error)) return error;
  const busy = await findBusy(db, input, timeZone, exceptId);
  return busy ? busyError(busy) : error;
}

function isExclusion(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23P01') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

async function readClassRow(
  db: Sql,
  classId: string,
): Promise<(ClassFields & { timeZone: string }) | undefined> {
  const rows = await db.execute<{
    hall_id: string;
    date: string;
    start_time: string;
    duration_minutes: number;
    class_type_id: string;
    audience: ClassFields['audience'];
    format: ClassFields['format'];
    places: number | null;
    time_zone: string;
  }>(sql`
    select c.hall_id, to_char(c.date, 'YYYY-MM-DD') as date,
           to_char(c.start_time, 'HH24:MI') as start_time,
           c.duration_minutes, c.class_type_id, c.audience, c.format, c.places,
           h.time_zone
      from scheduled_class c
      join resource h on h.id = c.hall_id
     where c.id = ${classId}
  `);
  const row = rows.rows[0];
  if (!row) return undefined;
  const trainers = await db.execute<{ trainer_id: string }>(sql`
    select trainer_id from scheduled_class_trainer
     where class_id = ${classId}
     order by created_at, trainer_id
  `);
  return {
    hallId: row.hall_id,
    date: row.date,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    trainerIds: trainers.rows.map((trainer) => trainer.trainer_id),
    classTypeId: row.class_type_id,
    audience: row.audience,
    format: row.format,
    places: row.places,
    timeZone: row.time_zone,
  };
}

export async function readClass(
  db: Sql,
  classId: string,
): Promise<ClassView | undefined> {
  const rows = await db.execute<{
    id: string;
    hall_id: string;
    date: string;
    start_time: string;
    duration_minutes: number;
    class_type_id: string;
    audience: ClassFields['audience'];
    format: ClassFields['format'];
    places: number | null;
    cancelled: boolean;
    created_at: Date;
    updated_at: Date;
  }>(sql`
    select id, hall_id, to_char(date, 'YYYY-MM-DD') as date,
           to_char(start_time, 'HH24:MI') as start_time,
           duration_minutes, class_type_id, audience, format, places, cancelled,
           created_at, updated_at
      from scheduled_class
     where id = ${classId}
  `);
  const row = rows.rows[0];
  if (!row) return undefined;
  const trainers = await db.execute<{ trainer_id: string }>(sql`
    select trainer_id from scheduled_class_trainer
     where class_id = ${classId}
     order by created_at, trainer_id
  `);
  return {
    id: row.id,
    hallId: row.hall_id,
    date: row.date,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    trainerIds: trainers.rows.map((trainer) => trainer.trainer_id),
    classTypeId: row.class_type_id,
    audience: row.audience,
    format: row.format,
    places: row.places,
    cancelled: row.cancelled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function zoneConflict(
  db: Sql,
  hallId: string,
  timeZone: string,
): Promise<ApiError | undefined> {
  const rows = await db.execute<BusyRow>(sql`
    with moved as (
      select c.id,
             (c.date + c.start_time) at time zone ${timeZone} as starts_at,
             (c.date + c.start_time) at time zone ${timeZone}
               + (c.duration_minutes || ' minutes')::interval as ends_at
        from scheduled_class c
       where c.hall_id = ${hallId} and not c.cancelled
    )
    select other.id as class_id, ct.name as class_type_name, h.name as hall_name,
           tr.name as trainer_name,
           to_char(other.start_time, 'HH24:MI') as start_time,
           other.duration_minutes, 'trainer'::text as kind
      from moved m
      join scheduled_class_trainer mine on mine.class_id = m.id
      join scheduled_class_trainer theirs
        on theirs.trainer_id = mine.trainer_id and theirs.class_id <> m.id
      join scheduled_class other on other.id = theirs.class_id and not other.cancelled
      join resource ct on ct.id = other.class_type_id
      join resource h on h.id = other.hall_id
      join resource tr on tr.id = mine.trainer_id
     where other.hall_id <> ${hallId}
       and tstzrange(m.starts_at, m.ends_at, '[)') && theirs.during
     order by other.date, other.start_time, other.id
     limit 1
  `);
  const row = rows.rows[0];
  return row ? busyError(row) : undefined;
}

export interface OverlapRow extends BusyRow {
  started: boolean;
  reason: 'hall' | 'trainer';
}

export async function listOverlaps(
  db: Sql,
  input: ClassFields,
  timeZone: string,
): Promise<OverlapRow[]> {
  const range = sql`tstzrange(
    (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
    ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
      + (${String(input.durationMinutes)} || ' minutes')::interval,
    '[)'
  )`;
  const rows = await db.execute<OverlapRow>(sql`
    select c.id as class_id, ct.name as class_type_name, h.name as hall_name,
           null::text as trainer_name,
           to_char(c.start_time, 'HH24:MI') as start_time,
           c.duration_minutes, 'hall'::text as kind, 'hall'::text as reason,
           c.starts_at <= now() as started
      from scheduled_class c
      join resource ct on ct.id = c.class_type_id
      join resource h on h.id = c.hall_id
     where c.hall_id = ${input.hallId}
       and not c.cancelled
       and tstzrange(c.starts_at, c.ends_at, '[)') && ${range}
    union all
    select c.id, ct.name, h.name, tr.name,
           to_char(c.start_time, 'HH24:MI'), c.duration_minutes,
           'trainer', 'trainer', c.starts_at <= now()
      from scheduled_class_trainer t
      join scheduled_class c on c.id = t.class_id
      join resource ct on ct.id = c.class_type_id
      join resource h on h.id = c.hall_id
      join resource tr on tr.id = t.trainer_id
     where t.trainer_id in (${sql.join(
       input.trainerIds.map((id) => sql`${id}`),
       sql`, `,
     )})
       and not c.cancelled
       and t.during && ${range}
     order by 1
  `);
  return rows.rows;
}

export async function deleteClass(db: Sql, classId: string): Promise<void> {
  await db.execute(sql`delete from scheduled_class where id = ${classId}`);
}

export async function retimeHall(
  db: Sql,
  hallId: string,
  timeZone: string,
): Promise<void> {
  await db.execute(sql`
    update scheduled_class
       set starts_at = (date + start_time) at time zone ${timeZone},
           ends_at = (date + start_time) at time zone ${timeZone}
             + (duration_minutes || ' minutes')::interval,
           updated_at = now()
     where hall_id = ${hallId}
  `);
  await db.execute(sql`
    update scheduled_class_trainer t
       set during = tstzrange(c.starts_at, c.ends_at, '[)')
      from scheduled_class c
     where t.class_id = c.id and c.hall_id = ${hallId} and not c.cancelled
  `);
}
