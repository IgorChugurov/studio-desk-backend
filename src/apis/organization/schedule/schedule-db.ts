import { sql } from 'drizzle-orm';
import {
  ApiError,
  type ScheduleConflict,
} from '../../../common/errors/api-error.js';
import type { ScheduleConfig } from '../../../common/organization-config.js';
import type { Database } from '../../../database/database.module.js';
import { busyMessage, endClock } from './schedule-time.js';
import {
  type CatalogResource,
  type CatalogType,
  type ConflictMode,
  type ResourceRole,
  type SlotFields,
  type SlotKind,
  slotTitle,
} from './schedule-validate.js';

export type Sql = Pick<Database, 'execute'>;

export type SlotStatus =
  | 'planned'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface SlotView extends SlotFields {
  id: string;
  date: string;
  status: SlotStatus;
  occupiesResources: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeConflict extends ScheduleConflict {
  slotId: string;
  started: boolean;
}

const NONE = '00000000-0000-0000-0000-000000000000';

export function occupiesOf(status: SlotStatus): boolean {
  return (
    status === 'planned' ||
    status === 'confirmed' ||
    status === 'in_progress' ||
    status === 'completed'
  );
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
  if (!today) throw ApiError.notFound('Organization not found');
  return today;
}

export async function readScheduleConfig(
  db: Sql,
  organizationId: string,
): Promise<ScheduleConfig> {
  const rows = await db.execute<{ schedule_config: ScheduleConfig }>(sql`
    select schedule_config from organization where id = ${organizationId}
  `);
  const config = rows.rows[0]?.schedule_config;
  if (!config) throw ApiError.notFound('Organization not found');
  return config;
}

export async function loadCatalog(
  db: Sql,
  organizationId: string,
): Promise<{
  resources: Map<string, CatalogResource>;
  places: CatalogResource[];
  types: CatalogType[];
}> {
  const typeRows = await db.execute<{
    id: string;
    role: ResourceRole;
    required: boolean;
    multiple: boolean;
    conflict_mode: ConflictMode;
    label: string;
  }>(sql`
    select id, role, required, multiple, conflict_mode,
           labels->'en'->>'singular' as label
      from organization_resource_type
     where organization_id = ${organizationId}
     order by sort_order
  `);
  const types: CatalogType[] = typeRows.rows.map((row) => ({
    id: row.id,
    role: row.role,
    required: row.required,
    multiple: row.multiple,
    conflictMode: row.conflict_mode,
    label: row.label,
  }));
  const resourceRows = await db.execute<{
    id: string;
    name: string;
    type: 'ordinary' | 'virtual' | null;
    time_zone: string | null;
    type_id: string;
    role: ResourceRole;
    required: boolean;
    multiple: boolean;
    conflict_mode: ConflictMode;
    label: string;
  }>(sql`
    select r.id, r.name, r.type, r.time_zone, t.id as type_id, t.role,
           t.required, t.multiple, t.conflict_mode,
           t.labels->'en'->>'singular' as label
      from resource r
      join organization_resource_type t on t.id = r.resource_type_id
     where r.organization_id = ${organizationId}
  `);
  const resources = new Map<string, CatalogResource>();
  for (const row of resourceRows.rows) {
    resources.set(row.id, {
      id: row.id,
      name: row.name,
      type: row.type,
      timeZone: row.time_zone,
      typeId: row.type_id,
      role: row.role,
      required: row.required,
      multiple: row.multiple,
      conflictMode: row.conflict_mode,
      label: row.label,
    });
  }
  const places = [...resources.values()].filter(
    (resource) => resource.role === 'place',
  );
  return { resources, places, types };
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

export async function insertSlot(
  db: Sql,
  organizationId: string,
  input: SlotFields & { date: string },
  timeZone: string,
  links: CatalogResource[],
  confirmOverlap: boolean,
): Promise<string> {
  await assertFree(db, organizationId, input, timeZone, null, confirmOverlap);
  await db.execute(sql`savepoint slot_write`);
  try {
    const id = crypto.randomUUID();
    await db.execute(sql`
      insert into schedule_slot (
        id, organization_id, kind, place_resource_id, date, start_time,
        duration_minutes, audience, format, places, note, blocks_all,
        status, occupies_resources, starts_at, ends_at
      ) values (
        ${id}, ${organizationId}, ${input.kind}, ${input.placeResourceId},
        ${input.date}::date, ${input.startTime}::time, ${input.durationMinutes},
        ${input.audience}, ${input.format}, ${input.places}, ${input.note},
        ${input.blocksAll}, 'planned', true,
        (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
        ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
          + (${String(input.durationMinutes)} || ' minutes')::interval
      )
    `);
    await writeLinks(db, organizationId, id, links, true);
    await db.execute(sql`release savepoint slot_write`);
    return id;
  } catch (error) {
    if (isDeadlock(error)) throw error;
    await db.execute(sql`rollback to savepoint slot_write`);
    throw await busyFrom(
      db,
      error,
      organizationId,
      input,
      timeZone,
      null,
      confirmOverlap,
    );
  }
}

export async function rewriteSlot(
  db: Sql,
  organizationId: string,
  slotId: string,
  input: SlotFields & { date: string; status: SlotStatus },
  timeZone: string,
  links: CatalogResource[],
  confirmOverlap: boolean,
): Promise<void> {
  const occupies = occupiesOf(input.status);
  if (occupies) {
    await assertFree(
      db,
      organizationId,
      input,
      timeZone,
      slotId,
      confirmOverlap,
    );
  }
  await db.execute(sql`savepoint slot_write`);
  try {
    await db.execute(sql`
      update schedule_slot
         set kind = ${input.kind},
             place_resource_id = ${input.placeResourceId},
             date = ${input.date}::date,
             start_time = ${input.startTime}::time,
             duration_minutes = ${input.durationMinutes},
             audience = ${input.audience},
             format = ${input.format},
             places = ${input.places},
             note = ${input.note},
             blocks_all = ${input.blocksAll},
             status = ${input.status},
             occupies_resources = ${occupies},
             starts_at = (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
             ends_at = ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
               + (${String(input.durationMinutes)} || ' minutes')::interval,
             updated_at = now()
       where id = ${slotId} and organization_id = ${organizationId}
    `);
    await db.execute(sql`
      delete from schedule_slot_resource where slot_id = ${slotId}
    `);
    await writeLinks(db, organizationId, slotId, links, occupies);
    await db.execute(sql`release savepoint slot_write`);
  } catch (error) {
    if (isDeadlock(error)) throw error;
    await db.execute(sql`rollback to savepoint slot_write`);
    throw await busyFrom(
      db,
      error,
      organizationId,
      input,
      timeZone,
      slotId,
      confirmOverlap,
    );
  }
}

export async function writeStatus(
  db: Sql,
  slotId: string,
  status: SlotStatus,
): Promise<void> {
  const occupies = occupiesOf(status);
  await db.execute(sql`savepoint slot_write`);
  try {
    await db.execute(sql`
      update schedule_slot
         set status = ${status},
             occupies_resources = ${occupies},
             updated_at = now()
       where id = ${slotId}
    `);
    await db.execute(sql`
      update schedule_slot_resource link
         set during = case
           when ${occupies} then tstzrange(s.starts_at, s.ends_at, '[)')
           else null
         end
        from schedule_slot s
       where link.slot_id = s.id and s.id = ${slotId}
    `);
    await db.execute(sql`release savepoint slot_write`);
  } catch (error) {
    if (isDeadlock(error)) throw error;
    await db.execute(sql`rollback to savepoint slot_write`);
    throw error;
  }
}

export async function deleteSlot(db: Sql, slotId: string): Promise<void> {
  await db.execute(sql`delete from schedule_slot where id = ${slotId}`);
}

export async function readSlot(
  db: Sql,
  slotId: string,
): Promise<SlotView | undefined> {
  const rows = await db.execute<{
    id: string;
    kind: SlotKind;
    place_resource_id: string;
    date: string;
    start_time: string;
    duration_minutes: number;
    audience: SlotFields['audience'];
    format: SlotFields['format'];
    places: number | null;
    note: string | null;
    blocks_all: boolean;
    status: SlotStatus;
    occupies_resources: boolean;
    created_at: Date;
    updated_at: Date;
  }>(sql`
    select id, kind, place_resource_id, to_char(date, 'YYYY-MM-DD') as date,
           to_char(start_time, 'HH24:MI') as start_time, duration_minutes,
           audience, format, places, note, blocks_all, status, occupies_resources,
           created_at, updated_at
      from schedule_slot
     where id = ${slotId}
  `);
  const row = rows.rows[0];
  if (!row) return undefined;
  const links = await db.execute<{ resource_id: string }>(sql`
    select resource_id from schedule_slot_resource
     where slot_id = ${slotId} and role <> 'place'
     order by created_at, resource_id
  `);
  return {
    id: row.id,
    kind: row.kind,
    placeResourceId: row.place_resource_id,
    resourceIds: links.rows.map((link) => link.resource_id),
    date: row.date,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    audience: row.audience,
    format: row.format,
    places: row.places,
    note: row.note,
    blocksAll: row.blocks_all,
    status: row.status,
    occupiesResources: row.occupies_resources,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function retryDeadlock<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isDeadlock(error)) throw error;
    return work();
  }
}

export async function findConflicts(
  db: Sql,
  organizationId: string,
  input: SlotFields & { date: string },
  timeZone: string,
  exceptId: string | null,
  ignore: readonly string[] = [],
): Promise<{ strict?: TimeConflict; warnings: TimeConflict[] }> {
  const involved = [input.placeResourceId, ...input.resourceIds];
  const except = exceptId ?? NONE;
  const blocksAll = input.kind === 'block' && input.blocksAll;
  const range = sql`tstzrange(
    (${input.date}::date + ${input.startTime}::time) at time zone ${timeZone},
    ((${input.date}::date + ${input.startTime}::time) at time zone ${timeZone})
      + (${String(input.durationMinutes)} || ' minutes')::interval,
    '[)'
  )`;
  const rows = await db.execute<{
    id: string;
    kind: SlotKind;
    note: string | null;
    blocks_all: boolean;
    place_resource_id: string;
    place_name: string;
    start_time: string;
    duration_minutes: number;
    started: boolean;
  }>(sql`
    select s.id, s.kind, s.note, s.blocks_all, s.place_resource_id,
           place.name as place_name,
           to_char(s.start_time, 'HH24:MI') as start_time,
           s.duration_minutes, s.starts_at <= now() as started
      from schedule_slot s
      join resource place on place.id = s.place_resource_id
     where s.organization_id = ${organizationId}
       and s.id <> ${except}
       ${
         ignore.length > 0
           ? sql`and s.id not in (${uuidIn([...ignore])})`
           : sql``
       }
       and s.occupies_resources
       and tstzrange(s.starts_at, s.ends_at, '[)') && ${range}
       and (
         ${blocksAll}
         or s.blocks_all
         or exists (
           select 1 from schedule_slot_resource link
            where link.slot_id = s.id
              and link.resource_id in (${uuidIn(involved)})
         )
       )
     order by s.date, s.start_time, s.id
  `);
  if (rows.rows.length === 0) return { warnings: [] };
  const links = await db.execute<{
    slot_id: string;
    resource_id: string;
    role: ResourceRole;
    name: string;
    conflict_mode: ConflictMode;
  }>(sql`
    select link.slot_id, link.resource_id, link.role, r.name, t.conflict_mode
      from schedule_slot_resource link
      join resource r on r.id = link.resource_id
      join organization_resource_type t on t.id = r.resource_type_id
     where link.slot_id in (${uuidIn(rows.rows.map((row) => row.id))})
     order by link.created_at, link.resource_id
  `);
  const bySlot = new Map<string, (typeof links.rows)[number][]>();
  for (const link of links.rows) {
    const list = bySlot.get(link.slot_id) ?? [];
    list.push(link);
    bySlot.set(link.slot_id, list);
  }
  const involvedSet = new Set(involved);
  let strict: TimeConflict | undefined;
  const warnings: TimeConflict[] = [];
  for (const row of rows.rows) {
    const slotLinks = bySlot.get(row.id) ?? [];
    const shared = slotLinks.filter((link) =>
      involvedSet.has(link.resource_id),
    );
    const strictLink = shared.find((link) => link.conflict_mode === 'strict');
    const warningLink = shared.find((link) => link.conflict_mode === 'warning');
    const offerings = slotLinks
      .filter((link) => link.role === 'offering')
      .map((link) => link.name);
    const title = slotTitle(row.kind, offerings, row.note);
    const start = row.start_time.slice(0, 5);
    const end = endClock(start, row.duration_minutes);
    const blockOverlap =
      row.kind === 'block' && (row.blocks_all || shared.length > 0);
    if (strictLink) {
      strict ??= conflictOf(
        strictLink.resource_id,
        strictLink.name,
        start,
        end,
        title,
        row.id,
        row.started,
      );
      continue;
    }
    if (warningLink || blockOverlap || blocksAll) {
      const resourceId = warningLink?.resource_id ?? row.place_resource_id;
      const resourceName = warningLink?.name ?? row.place_name;
      warnings.push(
        conflictOf(
          resourceId,
          resourceName,
          start,
          end,
          title,
          row.id,
          row.started,
        ),
      );
    }
  }
  return { strict, warnings };
}

export async function zoneConflict(
  db: Sql,
  placeId: string,
  timeZone: string,
): Promise<ScheduleConflict | undefined> {
  const rows = await db.execute<{
    slot_id: string;
    resource_id: string;
    resource_name: string;
    start_time: string;
    duration_minutes: number;
    kind: SlotKind;
    note: string | null;
    offerings: string | null;
  }>(sql`
    with moved as (
      select s.id,
             (s.date + s.start_time) at time zone ${timeZone} as starts_at,
             (s.date + s.start_time) at time zone ${timeZone}
               + (s.duration_minutes || ' minutes')::interval as ends_at
        from schedule_slot s
       where s.place_resource_id = ${placeId}
         and s.occupies_resources
    )
    select other.id as slot_id, res.id as resource_id, res.name as resource_name,
           to_char(other.start_time, 'HH24:MI') as start_time,
           other.duration_minutes, other.kind, other.note,
           (
             select string_agg(off.name, ', ' order by link.created_at, off.id)
               from schedule_slot_resource link
               join resource off on off.id = link.resource_id
              where link.slot_id = other.id and link.role = 'offering'
           ) as offerings
      from moved m
      join schedule_slot_resource mine
        on mine.slot_id = m.id and mine.enforce_no_overlap
      join schedule_slot_resource theirs
        on theirs.resource_id = mine.resource_id
       and theirs.slot_id <> m.id
       and theirs.enforce_no_overlap
       and theirs.during is not null
      join schedule_slot other
        on other.id = theirs.slot_id and other.occupies_resources
      join resource res on res.id = mine.resource_id
     where other.place_resource_id <> ${placeId}
       and tstzrange(m.starts_at, m.ends_at, '[)') && theirs.during
     order by other.date, other.start_time, other.id, res.name
     limit 1
  `);
  const row = rows.rows[0];
  if (!row) return undefined;
  const start = row.start_time.slice(0, 5);
  return {
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    start,
    end: endClock(start, row.duration_minutes),
    title: slotTitle(
      row.kind,
      row.offerings ? row.offerings.split(', ') : [],
      row.note,
    ),
    slotId: row.slot_id,
  };
}

export async function retimePlace(
  db: Sql,
  placeId: string,
  timeZone: string,
): Promise<void> {
  await db.execute(sql`savepoint slot_write`);
  try {
    await db.execute(sql`
      update schedule_slot
         set starts_at = (date + start_time) at time zone ${timeZone},
             ends_at = (date + start_time) at time zone ${timeZone}
               + (duration_minutes || ' minutes')::interval,
             updated_at = now()
       where place_resource_id = ${placeId}
    `);
    await db.execute(sql`
      update schedule_slot_resource link
         set during = case
           when s.occupies_resources then tstzrange(s.starts_at, s.ends_at, '[)')
           else null
         end
        from schedule_slot s
       where link.slot_id = s.id and s.place_resource_id = ${placeId}
    `);
    await db.execute(sql`release savepoint slot_write`);
  } catch (error) {
    if (isDeadlock(error)) throw error;
    await db.execute(sql`rollback to savepoint slot_write`);
    if (!isExclusion(error)) throw error;
    const conflict = await zoneConflict(db, placeId, timeZone);
    if (!conflict) throw error;
    throw strictError(conflict);
  }
}

async function writeLinks(
  db: Sql,
  organizationId: string,
  slotId: string,
  links: CatalogResource[],
  occupies: boolean,
): Promise<void> {
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]!;
    const role = index === 0 ? 'place' : link.role;
    await db.execute(sql`
      insert into schedule_slot_resource (
        organization_id, slot_id, resource_id, role, enforce_no_overlap, during, created_at
      )
      select ${organizationId}, ${slotId}, ${link.id}, ${role},
             ${link.conflictMode === 'strict'},
             case when ${occupies} then tstzrange(starts_at, ends_at, '[)') else null end,
             now() + (${String(index)} || ' milliseconds')::interval
        from schedule_slot
       where id = ${slotId}
    `);
  }
}

async function assertFree(
  db: Sql,
  organizationId: string,
  input: SlotFields & { date: string },
  timeZone: string,
  exceptId: string | null,
  confirmOverlap: boolean,
): Promise<void> {
  const found = await findConflicts(
    db,
    organizationId,
    input,
    timeZone,
    exceptId,
  );
  if (found.strict) throw strictError(found.strict);
  if (found.warnings.length > 0 && !confirmOverlap) {
    throw warningError(found.warnings);
  }
}

async function busyFrom(
  db: Sql,
  error: unknown,
  organizationId: string,
  input: SlotFields & { date: string },
  timeZone: string,
  exceptId: string | null,
  confirmOverlap: boolean,
): Promise<unknown> {
  if (!isExclusion(error)) return error;
  const found = await findConflicts(
    db,
    organizationId,
    input,
    timeZone,
    exceptId,
  );
  if (found.strict) return strictError(found.strict);
  if (found.warnings.length > 0 && !confirmOverlap) {
    return warningError(found.warnings);
  }
  return error;
}

function conflictOf(
  resourceId: string,
  resourceName: string,
  start: string,
  end: string,
  title: string,
  slotId: string,
  started: boolean,
): TimeConflict {
  return { resourceId, resourceName, start, end, title, slotId, started };
}

function strictError(conflict: ScheduleConflict): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'RESOURCE_BUSY',
    message: busyMessage(conflict),
    conflict,
  });
}

function warningError(conflicts: TimeConflict[]): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'OVERLAP_WARNING',
    message: 'This time overlaps another slot',
    conflicts,
  });
}

function uuidIn(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

function isDeadlock(error: unknown): boolean {
  return hasCode(error, '40P01');
}

function isExclusion(error: unknown): boolean {
  return hasCode(error, '23P01');
}

function hasCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === code) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
