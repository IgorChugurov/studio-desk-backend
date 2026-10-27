import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { assertWriter, openSchedule } from './schedule-access.js';
import type { ClassFields } from './schedule-db.js';
import { assertClassRefs, hallOf, placeErrors } from './schedule-db.js';
import {
  clocksOverlap,
  endClock,
  endsAfterMidnight,
  hallBusyText,
  trainerBusyText,
} from './schedule-time.js';

const WEEKDAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

interface RowInput extends Omit<ClassFields, 'date'> {
  weekday: string;
}

export interface StoredRow extends RowInput {
  id: string;
}

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
      if (isUnique(error)) {
        throw new ApiError({
          statusCode: 409,
          code: 'TEMPLATE_NAME_TAKEN',
          message: 'A template with this name already exists',
          field: 'name',
        });
      }
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
      if (isUnique(error)) {
        throw new ApiError({
          statusCode: 409,
          code: 'TEMPLATE_NAME_TAKEN',
          message: 'A template with this name already exists',
          field: 'name',
        });
      }
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
    input: RowInput,
  ) {
    await this.write(session);
    await this.read(session.organizationId, templateId);
    await this.checkRow(session.organizationId, templateId, input, null);
    const id = crypto.randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into week_template_row (
          id, organization_id, template_id, weekday, start_time, duration_minutes,
          hall_id, class_type_id, audience, format, places
        ) values (
          ${id}, ${session.organizationId}, ${templateId}, ${input.weekday},
          ${input.startTime}::time, ${input.durationMinutes}, ${input.hallId},
          ${input.classTypeId}, ${input.audience}, ${input.format}, ${input.places}
        )
      `);
      await this.writeTrainers(
        tx,
        session.organizationId,
        id,
        input.trainerIds,
      );
    });
    return this.read(session.organizationId, templateId);
  }

  async updateRow(
    session: StudioSessionInfo,
    templateId: string,
    rowId: string,
    patch: Partial<RowInput>,
  ) {
    await this.write(session);
    const template = await this.read(session.organizationId, templateId);
    const current = template.rows.find((row) => row.id === rowId);
    if (!current) throw ApiError.notFound('Row not found');
    const next: RowInput = {
      weekday: patch.weekday ?? current.weekday,
      startTime: patch.startTime ?? current.startTime,
      durationMinutes: patch.durationMinutes ?? current.durationMinutes,
      hallId: patch.hallId ?? current.hallId,
      trainerIds: patch.trainerIds ?? current.trainerIds,
      classTypeId: patch.classTypeId ?? current.classTypeId,
      audience: patch.audience ?? current.audience,
      format: patch.format ?? current.format,
      places: patch.places === undefined ? current.places : patch.places,
    };
    await this.checkRow(session.organizationId, templateId, next, rowId);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        update week_template_row
           set weekday = ${next.weekday},
               start_time = ${next.startTime}::time,
               duration_minutes = ${next.durationMinutes},
               hall_id = ${next.hallId},
               class_type_id = ${next.classTypeId},
               audience = ${next.audience},
               format = ${next.format},
               places = ${next.places},
               updated_at = now()
         where id = ${rowId}
      `);
      await tx.execute(
        sql`delete from week_template_row_trainer where row_id = ${rowId}`,
      );
      await this.writeTrainers(
        tx,
        session.organizationId,
        rowId,
        next.trainerIds,
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

  private async checkRow(
    organizationId: string,
    templateId: string,
    input: RowInput,
    exceptId: string | null,
  ) {
    if (endsAfterMidnight(input.startTime, input.durationMinutes)) {
      throw ApiError.validation([
        {
          code: 'INVALID_VALUE',
          field: 'startTime',
          message: 'A class must end by midnight',
        },
      ]);
    }
    const hall = await hallOf(this.db, organizationId, input.hallId);
    const places = placeErrors(hall.type, input);
    if (places.length > 0) throw ApiError.validation(places);
    await assertClassRefs(this.db, organizationId, input);
    const template = await this.read(organizationId, templateId);
    for (const row of template.rows) {
      if (row.id === exceptId || row.weekday !== input.weekday) continue;
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
      const sharedTrainer = row.trainerIds.find((id) =>
        input.trainerIds.includes(id),
      );
      if (row.hallId === input.hallId) {
        const name = await this.classTypeName(row.classTypeId);
        throw new ApiError({
          statusCode: 409,
          code: 'HALL_BUSY',
          message: hallBusyText(
            name,
            row.startTime,
            endClock(row.startTime, row.durationMinutes),
          ),
          conflict: {
            classTypeName: name,
            start: row.startTime,
            end: endClock(row.startTime, row.durationMinutes),
          },
        });
      }
      if (sharedTrainer) {
        const trainer = await this.trainerName(sharedTrainer);
        throw new ApiError({
          statusCode: 409,
          code: 'TRAINER_BUSY',
          message: trainerBusyText(
            trainer,
            hall.name,
            row.startTime,
            endClock(row.startTime, row.durationMinutes),
          ),
          conflict: {
            trainerName: trainer,
            hallName: hall.name,
            start: row.startTime,
            end: endClock(row.startTime, row.durationMinutes),
          },
        });
      }
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
      weekday: string;
      start_time: string;
      duration_minutes: number;
      hall_id: string;
      class_type_id: string;
      audience: RowInput['audience'];
      format: RowInput['format'];
      places: number | null;
    }>(sql`
      select id, weekday, to_char(start_time, 'HH24:MI') as start_time,
             duration_minutes, hall_id, class_type_id, audience, format, places
        from week_template_row
       where template_id = ${id}
    `);
    const rows: StoredRow[] = [];
    for (const row of rowRows.rows) {
      const trainers = await this.db.execute<{ trainer_id: string }>(sql`
        select trainer_id from week_template_row_trainer
         where row_id = ${row.id}
         order by created_at, trainer_id
      `);
      rows.push({
        id: row.id,
        weekday: row.weekday,
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
        hallId: row.hall_id,
        classTypeId: row.class_type_id,
        audience: row.audience,
        format: row.format,
        places: row.places,
        trainerIds: trainers.rows.map((trainer) => trainer.trainer_id),
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

  private async writeTrainers(
    db: Pick<Database, 'execute'>,
    organizationId: string,
    rowId: string,
    trainerIds: string[],
  ) {
    for (let index = 0; index < trainerIds.length; index += 1) {
      await db.execute(sql`
        insert into week_template_row_trainer (organization_id, row_id, trainer_id, created_at)
        values (
          ${organizationId}, ${rowId}, ${trainerIds[index]},
          now() + (${String(index)} || ' milliseconds')::interval
        )
      `);
    }
  }

  private async classTypeName(id: string): Promise<string> {
    const rows = await this.db.execute<{ name: string }>(
      sql`select name from class_type where id = ${id}`,
    );
    return rows.rows[0]?.name ?? '';
  }

  private async trainerName(id: string): Promise<string> {
    const rows = await this.db.execute<{ name: string }>(
      sql`select name from trainer where id = ${id}`,
    );
    return rows.rows[0]?.name ?? '';
  }

  private async write(session: StudioSessionInfo) {
    const actor = await openSchedule(this.access, this.db, session);
    assertWriter(actor.role);
  }
}

function isUnique(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
