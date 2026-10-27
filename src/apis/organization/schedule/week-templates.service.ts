import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { assertWriter, openSchedule } from './schedule-access.js';
import { loadCatalog, readScheduleConfig } from './schedule-db.js';
import { busyMessage, clocksOverlap, endClock } from './schedule-time.js';
import {
  type ConflictMode,
  prepareSlot,
  type SlotDraft,
  type SlotFields,
  type SlotKind,
  slotTitle,
} from './schedule-validate.js';

const WEEKDAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export interface StoredRow extends SlotFields {
  id: string;
  weekday: string;
}

type RowDraft = SlotDraft & { weekday: string };

@Injectable()
export class WeekTemplatesService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async list(
    session: StudioSessionInfo,
    query: {
      currentPage: number;
      perPage: number;
      search?: string;
      sortBy: 'createdAt' | 'name';
      order: 'ASC' | 'DESC';
    },
  ) {
    await this.write(session);
    const pattern = query.search
      ? `%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
      : null;
    const where = pattern
      ? sql`organization_id = ${session.organizationId} and name ilike ${pattern} escape '\\'`
      : sql`organization_id = ${session.organizationId}`;
    const total = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from week_template where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'name' ? sql`name` : sql`created_at`;
    const direction = query.order === 'ASC' ? sql`asc` : sql`desc`;
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from week_template
       where ${where}
       order by ${column} ${direction}, id
       limit ${query.perPage} offset ${offset}
    `);
    const items = [];
    for (const row of rows.rows) {
      items.push(await this.read(session.organizationId, row.id));
    }
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items,
      meta: {
        currentPage: query.currentPage,
        perPage: query.perPage,
        totalItems,
        totalPages,
        hasPreviousPage: query.currentPage > 1,
        hasNextPage: query.currentPage < totalPages,
      },
    };
  }

  async create(session: StudioSessionInfo, name: string) {
    await this.write(session);
    try {
      const inserted = await this.db.execute<{ id: string }>(sql`
        insert into week_template (organization_id, name)
        values (${session.organizationId}, ${name})
        returning id
      `);
      return this.read(session.organizationId, inserted.rows[0]!.id);
    } catch (error) {
      if (isUnique(error)) throw nameTaken();
      throw error;
    }
  }

  async get(session: StudioSessionInfo, id: string) {
    await this.write(session);
    return this.read(session.organizationId, id);
  }

  async rename(session: StudioSessionInfo, id: string, name: string) {
    await this.write(session);
    await this.read(session.organizationId, id);
    try {
      await this.db.execute(sql`
        update week_template
           set name = ${name}, updated_at = now()
         where id = ${id} and organization_id = ${session.organizationId}
      `);
    } catch (error) {
      if (isUnique(error)) throw nameTaken();
      throw error;
    }
    return this.read(session.organizationId, id);
  }

  async remove(session: StudioSessionInfo, id: string) {
    await this.write(session);
    const deleted = await this.db.execute<{ id: string }>(sql`
      delete from week_template
       where id = ${id} and organization_id = ${session.organizationId}
      returning id
    `);
    if (!deleted.rows[0]) throw ApiError.notFound('Template not found');
  }

  async addRow(
    session: StudioSessionInfo,
    templateId: string,
    input: RowDraft,
  ) {
    await this.write(session);
    await this.read(session.organizationId, templateId);
    const prepared = await this.prepare(session.organizationId, input);
    await this.assertStrict(
      session.organizationId,
      templateId,
      prepared,
      input.weekday,
      null,
    );
    const id = crypto.randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into week_template_row (
          id, organization_id, template_id, kind, weekday, start_time,
          duration_minutes, place_resource_id, audience, format, places,
          note, blocks_all
        ) values (
          ${id}, ${session.organizationId}, ${templateId}, ${prepared.kind},
          ${input.weekday}, ${prepared.startTime}::time, ${prepared.durationMinutes},
          ${prepared.placeResourceId}, ${prepared.audience}, ${prepared.format},
          ${prepared.places}, ${prepared.note}, ${prepared.blocksAll}
        )
      `);
      await writeResources(
        tx,
        session.organizationId,
        id,
        prepared.resourceIds,
      );
    });
    return this.read(session.organizationId, templateId);
  }

  async updateRow(
    session: StudioSessionInfo,
    templateId: string,
    rowId: string,
    patch: Partial<RowDraft>,
  ) {
    await this.write(session);
    const template = await this.read(session.organizationId, templateId);
    const current = template.rows.find((row) => row.id === rowId);
    if (!current) throw ApiError.notFound('Row not found');
    const next: RowDraft = {
      kind: patch.kind ?? current.kind,
      weekday: patch.weekday ?? current.weekday,
      startTime: patch.startTime ?? current.startTime,
      durationMinutes: patch.durationMinutes ?? current.durationMinutes,
      placeResourceId: patch.placeResourceId ?? current.placeResourceId,
      resourceIds: patch.resourceIds ?? current.resourceIds,
      audience:
        patch.audience === undefined ? current.audience : patch.audience,
      format: patch.format === undefined ? current.format : patch.format,
      places: patch.places === undefined ? current.places : patch.places,
      note: patch.note === undefined ? current.note : patch.note,
      blocksAll: patch.blocksAll ?? current.blocksAll,
    };
    const prepared = await this.prepare(session.organizationId, next);
    await this.assertStrict(
      session.organizationId,
      templateId,
      prepared,
      next.weekday,
      rowId,
    );
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        update week_template_row
           set kind = ${prepared.kind},
               weekday = ${next.weekday},
               start_time = ${prepared.startTime}::time,
               duration_minutes = ${prepared.durationMinutes},
               place_resource_id = ${prepared.placeResourceId},
               audience = ${prepared.audience},
               format = ${prepared.format},
               places = ${prepared.places},
               note = ${prepared.note},
               blocks_all = ${prepared.blocksAll},
               updated_at = now()
         where id = ${rowId}
      `);
      await tx.execute(sql`
        delete from week_template_row_resource where row_id = ${rowId}
      `);
      await writeResources(
        tx,
        session.organizationId,
        rowId,
        prepared.resourceIds,
      );
    });
    return this.read(session.organizationId, templateId);
  }

  async removeRow(
    session: StudioSessionInfo,
    templateId: string,
    rowId: string,
  ) {
    await this.write(session);
    const deleted = await this.db.execute<{ id: string }>(sql`
      delete from week_template_row
       where id = ${rowId}
         and template_id = ${templateId}
         and organization_id = ${session.organizationId}
      returning id
    `);
    if (!deleted.rows[0]) throw ApiError.notFound('Row not found');
  }

  private async prepare(organizationId: string, input: RowDraft) {
    const [catalog, config] = await Promise.all([
      loadCatalog(this.db, organizationId),
      readScheduleConfig(this.db, organizationId),
    ]);
    const prepared = prepareSlot(
      input,
      catalog.resources,
      catalog.places,
      catalog.types,
      config,
    );
    if (!prepared.value || prepared.errors.length > 0) {
      throw ApiError.validation(prepared.errors);
    }
    return prepared.value;
  }

  private async assertStrict(
    organizationId: string,
    templateId: string,
    input: SlotFields,
    weekday: string,
    exceptId: string | null,
  ) {
    const template = await this.read(organizationId, templateId);
    const ids = [
      input.placeResourceId,
      ...input.resourceIds,
      ...template.rows.flatMap((row) => [
        row.placeResourceId,
        ...row.resourceIds,
      ]),
    ];
    const modes = await conflictModes(this.db, organizationId, ids);
    const names = await resourceNames(this.db, ids);
    const mine = strictIds(input.placeResourceId, input.resourceIds, modes);
    for (const row of template.rows) {
      if (row.id === exceptId || row.weekday !== weekday) continue;
      if (
        !clocksOverlap(
          row.startTime,
          row.durationMinutes,
          input.startTime,
          input.durationMinutes,
        )
      ) {
        continue;
      }
      const shared = strictIds(
        row.placeResourceId,
        row.resourceIds,
        modes,
      ).find((id) => mine.includes(id));
      if (!shared) continue;
      const title = slotTitle(
        row.kind,
        offeringNames(row, names, modes),
        row.note,
      );
      const start = row.startTime;
      const end = endClock(start, row.durationMinutes);
      const conflict = {
        resourceId: shared,
        resourceName: names.get(shared) ?? '',
        start,
        end,
        title,
      };
      throw new ApiError({
        statusCode: 409,
        code: 'RESOURCE_BUSY',
        message: busyMessage(conflict),
        conflict,
      });
    }
  }

  private async read(organizationId: string, id: string) {
    const templates = await this.db.execute<{
      id: string;
      name: string;
      created_at: Date;
      updated_at: Date;
    }>(sql`
      select id, name, created_at, updated_at
        from week_template
       where id = ${id} and organization_id = ${organizationId}
    `);
    const template = templates.rows[0];
    if (!template) throw ApiError.notFound('Template not found');
    const rowRows = await this.db.execute<{
      id: string;
      kind: SlotKind;
      weekday: string;
      start_time: string;
      duration_minutes: number;
      place_resource_id: string;
      audience: SlotFields['audience'];
      format: SlotFields['format'];
      places: number | null;
      note: string | null;
      blocks_all: boolean;
    }>(sql`
      select id, kind, weekday, to_char(start_time, 'HH24:MI') as start_time,
             duration_minutes, place_resource_id, audience, format, places,
             note, blocks_all
        from week_template_row
       where template_id = ${id}
    `);
    const rows: StoredRow[] = [];
    for (const row of rowRows.rows) {
      const links = await this.db.execute<{ resource_id: string }>(sql`
        select resource_id from week_template_row_resource
         where row_id = ${row.id}
         order by created_at, resource_id
      `);
      rows.push({
        id: row.id,
        kind: row.kind,
        weekday: row.weekday,
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
        placeResourceId: row.place_resource_id,
        resourceIds: links.rows.map((link) => link.resource_id),
        audience: row.audience,
        format: row.format,
        places: row.places,
        note: row.note,
        blocksAll: row.blocks_all,
      });
    }
    rows.sort((a, b) => {
      const day =
        WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday);
      if (day !== 0) return day;
      return a.startTime.localeCompare(b.startTime);
    });
    return {
      id: template.id,
      name: template.name,
      rows,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    };
  }

  private async write(session: StudioSessionInfo) {
    const actor = await openSchedule(this.access, this.db, session);
    assertWriter(actor.role);
  }
}

function offeringNames(
  row: SlotFields,
  names: Map<string, string>,
  modes: Map<string, ConflictMode>,
): string[] {
  return row.resourceIds
    .filter((id) => modes.get(id) !== 'strict' && modes.get(id) !== 'warning')
    .map((id) => names.get(id))
    .filter((name): name is string => name !== undefined);
}

async function conflictModes(
  db: Pick<Database, 'execute'>,
  organizationId: string,
  ids: string[],
): Promise<Map<string, ConflictMode>> {
  const unique = [...new Set(ids)];
  const modes = new Map<string, ConflictMode>();
  if (unique.length === 0) return modes;
  const rows = await db.execute<{
    id: string;
    conflict_mode: ConflictMode;
  }>(sql`
    select r.id, t.conflict_mode
      from resource r
      join organization_resource_type t on t.id = r.resource_type_id
     where r.organization_id = ${organizationId}
       and r.id in (${sql.join(
         unique.map((id) => sql`${id}`),
         sql`, `,
       )})
  `);
  for (const row of rows.rows) modes.set(row.id, row.conflict_mode);
  return modes;
}

async function resourceNames(
  db: Pick<Database, 'execute'>,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const rows = await db.execute<{ id: string; name: string }>(sql`
    select id, name from resource
     where id in (${sql.join(
       unique.map((id) => sql`${id}`),
       sql`, `,
     )})
  `);
  for (const row of rows.rows) names.set(row.id, row.name);
  return names;
}

function strictIds(
  placeId: string,
  resourceIds: string[],
  modes: Map<string, ConflictMode>,
): string[] {
  return [placeId, ...resourceIds].filter((id) => modes.get(id) === 'strict');
}

async function writeResources(
  db: Pick<Database, 'execute'>,
  organizationId: string,
  rowId: string,
  resourceIds: string[],
) {
  for (let index = 0; index < resourceIds.length; index += 1) {
    await db.execute(sql`
      insert into week_template_row_resource (
        organization_id, row_id, resource_id, created_at
      ) values (
        ${organizationId}, ${rowId}, ${resourceIds[index]},
        now() + (${String(index)} || ' milliseconds')::interval
      )
    `);
  }
}

function nameTaken(): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'TEMPLATE_NAME_TAKEN',
    message: 'A template with this name already exists',
    field: 'name',
  });
}

function isUnique(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
