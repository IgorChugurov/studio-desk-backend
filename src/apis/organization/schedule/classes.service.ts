import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import {
  assertWriter,
  openSchedule,
  pageForbidden,
} from './schedule-access.js';
import type { ClassFields, ClassView } from './schedule-db.js';
import {
  assertClassRefs,
  deleteClass,
  hallOf,
  insertClass,
  isPast,
  placeErrors,
  readClass,
  rewriteClass,
  setCancelled,
  studioToday,
} from './schedule-db.js';
import {
  addDays,
  endsAfterMidnight,
  inclusiveDays,
  mondayOf,
} from './schedule-time.js';

@Injectable()
export class ClassesService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async list(
    session: StudioSessionInfo,
    query: { from: string; to: string; hallId?: string; trainerId?: string },
  ) {
    const actor = await openSchedule(this.access, this.db, session);
    if (
      actor.trainerId &&
      query.trainerId &&
      query.trainerId !== actor.trainerId
    ) {
      throw pageForbidden();
    }
    const trainerId = actor.trainerId ?? query.trainerId;
    const today = await studioToday(this.db, session.organizationId);
    const start = mondayOf(query.from);
    const end = addDays(mondayOf(query.to), 6);
    if (start < mondayOf(today) || inclusiveDays(start, end) > 366) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'from',
          message: 'Choose a week from the current week, within a year',
        },
      ]);
    }
    if (end < start) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'to',
          message: 'Choose an end week on or after the start week',
        },
      ]);
    }
    if (query.hallId)
      await this.hallInStudio(session.organizationId, query.hallId);
    const rows = await this.db.execute<{ id: string }>(sql`
      select c.id
        from scheduled_class c
       where c.organization_id = ${session.organizationId}
         and c.date between ${start}::date and ${end}::date
         ${query.hallId ? sql`and c.hall_id = ${query.hallId}` : sql``}
         ${
           trainerId
             ? sql`and exists (
                 select 1 from scheduled_class_trainer t
                  where t.class_id = c.id and t.trainer_id = ${trainerId}
               )`
             : sql``
         }
       order by c.date, c.start_time, c.id
    `);
    const items: ClassView[] = [];
    for (const row of rows.rows) {
      const item = await readClass(this.db, row.id);
      if (item) items.push(item);
    }
    return { items };
  }

  async get(session: StudioSessionInfo, id: string) {
    const actor = await openSchedule(this.access, this.db, session);
    const item = await this.inStudio(session.organizationId, id);
    if (actor.trainerId && !item.trainerIds.includes(actor.trainerId)) {
      throw ApiError.notFound('Class not found');
    }
    return item;
  }

  async create(session: StudioSessionInfo, input: ClassFields) {
    await this.writer(session);
    const hall = await this.prepare(session.organizationId, input);
    if (await isPast(this.db, hall.timeZone, input.date, input.startTime)) {
      throw alreadyStarted();
    }
    const id = await this.db.transaction(async (tx) =>
      insertClass(tx, session.organizationId, input, hall.timeZone),
    );
    return readClass(this.db, id);
  }

  async update(
    session: StudioSessionInfo,
    id: string,
    patch: Partial<ClassFields> & { classTypeId?: string },
  ) {
    await this.writer(session);
    const current = await this.inStudio(session.organizationId, id);
    await this.assertEditable(current);
    if (patch.classTypeId && patch.classTypeId !== current.classTypeId) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'classTypeId',
          message: 'Change the class type with replace',
        },
      ]);
    }
    const next = merge(current, patch);
    const hall = await this.prepare(session.organizationId, next);
    if (await isPast(this.db, hall.timeZone, next.date, next.startTime)) {
      throw alreadyStarted();
    }
    await this.db.transaction(async (tx) => {
      await rewriteClass(tx, session.organizationId, id, next, hall.timeZone);
    });
    return readClass(this.db, id);
  }

  async cancel(session: StudioSessionInfo, id: string) {
    await this.writer(session);
    const current = await this.inStudio(session.organizationId, id);
    await this.assertEditable(current);
    if (current.cancelled) throw cancelled();
    await this.db.transaction(async (tx) => setCancelled(tx, id, true));
    return readClass(this.db, id);
  }

  async restore(session: StudioSessionInfo, id: string) {
    await this.writer(session);
    const current = await this.inStudio(session.organizationId, id);
    const hall = await hallOf(this.db, session.organizationId, current.hallId);
    if (await isPast(this.db, hall.timeZone, current.date, current.startTime)) {
      throw alreadyStarted();
    }
    if (!current.cancelled) throw notCancelled();
    await this.db.transaction(async (tx) => setCancelled(tx, id, false));
    return readClass(this.db, id);
  }

  async remove(session: StudioSessionInfo, id: string) {
    await this.writer(session);
    const current = await this.inStudio(session.organizationId, id);
    const hall = await hallOf(this.db, session.organizationId, current.hallId);
    if (await isPast(this.db, hall.timeZone, current.date, current.startTime)) {
      throw alreadyStarted();
    }
    await deleteClass(this.db, id);
  }

  async replace(session: StudioSessionInfo, id: string, input: ClassFields) {
    await this.writer(session);
    const current = await this.inStudio(session.organizationId, id);
    const oldHall = await hallOf(
      this.db,
      session.organizationId,
      current.hallId,
    );
    if (
      await isPast(this.db, oldHall.timeZone, current.date, current.startTime)
    ) {
      throw alreadyStarted();
    }
    if (current.cancelled) throw cancelled();
    const hall = await this.prepare(session.organizationId, input);
    if (await isPast(this.db, hall.timeZone, input.date, input.startTime)) {
      throw alreadyStarted();
    }
    const created = await this.db.transaction(async (tx) => {
      await setCancelled(tx, id, true);
      return insertClass(tx, session.organizationId, input, hall.timeZone);
    });
    return readClass(this.db, created);
  }

  private async prepare(organizationId: string, input: ClassFields) {
    if (endsAfterMidnight(input.startTime, input.durationMinutes)) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'startTime',
          message: 'A class must end by midnight',
        },
      ]);
    }
    const hall = await hallOf(this.db, organizationId, input.hallId);
    const places = placeErrors(hall.type, input);
    if (places.length > 0) throw ApiError.validation(places);
    await assertClassRefs(this.db, organizationId, input);
    return hall;
  }

  private async assertEditable(current: ClassView) {
    const zone = await this.zoneOf(current.hallId);
    if (await isPast(this.db, zone, current.date, current.startTime)) {
      throw alreadyStarted();
    }
    if (current.cancelled) throw cancelled();
  }

  private async zoneOf(hallId: string): Promise<string> {
    const rows = await this.db.execute<{ time_zone: string }>(
      sql`select time_zone from hall where id = ${hallId}`,
    );
    return rows.rows[0]?.time_zone ?? 'UTC';
  }

  private async inStudio(
    organizationId: string,
    id: string,
  ): Promise<ClassView> {
    const item = await readClass(this.db, id);
    if (!item) throw ApiError.notFound('Class not found');
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from scheduled_class where id = ${id} and organization_id = ${organizationId}
    `);
    if (!rows.rows[0]) throw ApiError.notFound('Class not found');
    return item;
  }

  private async hallInStudio(organizationId: string, hallId: string) {
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from hall where id = ${hallId} and organization_id = ${organizationId}
    `);
    if (!rows.rows[0]) throw ApiError.notFound('Hall not found');
  }

  private async writer(session: StudioSessionInfo) {
    const actor = await openSchedule(this.access, this.db, session);
    assertWriter(actor.role);
  }
}

function merge(current: ClassView, patch: Partial<ClassFields>): ClassFields {
  return {
    hallId: patch.hallId ?? current.hallId,
    date: patch.date ?? current.date,
    startTime: patch.startTime ?? current.startTime,
    durationMinutes: patch.durationMinutes ?? current.durationMinutes,
    trainerIds: patch.trainerIds ?? current.trainerIds,
    classTypeId: current.classTypeId,
    audience: patch.audience ?? current.audience,
    format: patch.format ?? current.format,
    places: patch.places === undefined ? current.places : patch.places,
  };
}

function alreadyStarted(): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'CLASS_ALREADY_STARTED',
    message: 'The class has already started',
  });
}

function cancelled(): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'CLASS_CANCELLED',
    message: 'The class is cancelled',
  });
}

function notCancelled(): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'NOT_CANCELLED',
    message: 'The class is not cancelled',
  });
}
