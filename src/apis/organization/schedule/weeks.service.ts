import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { assertWriter, openSchedule } from './schedule-access.js';
import type { ClassFields } from './schedule-db.js';
import {
  deleteClass,
  hallOf,
  insertClass,
  isPast,
  listOverlaps,
  studioToday,
} from './schedule-db.js';
import {
  addDays,
  appliedText,
  clearPreviewText,
  eachDate,
  endClock,
  hallBusyText,
  mondayOf,
  replacePreviewText,
  trainerBusyText,
  weekdayOf,
} from './schedule-time.js';

interface Choice {
  rowId: string;
  date: string;
  choice: 'keep_existing' | 'apply_new';
}

interface Occurrence extends ClassFields {
  rowId: string;
  timeZone: string;
  classTypeName: string;
}

@Injectable()
export class WeeksService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async apply(
    session: StudioSessionInfo,
    input: { templateId: string; from: string; to: string; choices?: Choice[] },
  ) {
    await this.writer(session);
    const span = await this.span(session.organizationId, input.from, input.to);
    const plan = await this.plan(
      session.organizationId,
      input.templateId,
      span,
      new Set(),
    );
    return this.finish(
      session.organizationId,
      plan,
      input.choices ?? [],
      false,
      [],
    );
  }

  async clear(
    session: StudioSessionInfo,
    input: {
      from: string;
      to: string;
      hallIds: string[] | null;
      preview: boolean;
    },
  ) {
    await this.writer(session);
    const span = await this.span(session.organizationId, input.from, input.to);
    await this.assertHalls(session.organizationId, input.hallIds);
    const ids = await this.clearable(
      session.organizationId,
      span,
      input.hallIds,
    );
    if (input.preview) {
      return { deleted: ids.length, text: clearPreviewText(ids.length) };
    }
    await this.db.transaction(async (tx) => {
      for (const id of ids) await deleteClass(tx, id);
    });
    return { deleted: ids.length, text: 'Weeks cleared' };
  }

  async replace(
    session: StudioSessionInfo,
    input: {
      templateId: string;
      from: string;
      to: string;
      clear: 'template_halls' | 'all_halls';
      preview: boolean;
      choices?: Choice[];
    },
  ) {
    await this.writer(session);
    const span = await this.span(session.organizationId, input.from, input.to);
    const draft = await this.plan(
      session.organizationId,
      input.templateId,
      span,
      new Set(),
    );
    const hallIds =
      input.clear === 'all_halls'
        ? null
        : [...new Set(draft.occurrences.map((item) => item.hallId))];
    const doomed = await this.clearable(session.organizationId, span, hallIds);
    const plan = await this.plan(
      session.organizationId,
      input.templateId,
      span,
      new Set(doomed),
    );
    if (input.preview) {
      return {
        deleted: doomed.length,
        created: plan.fresh.length + plan.conflicts.length,
        text: replacePreviewText(
          doomed.length,
          plan.fresh.length + plan.conflicts.length,
        ),
      };
    }
    const outcome = await this.finish(
      session.organizationId,
      plan,
      input.choices ?? [],
      true,
      doomed,
    );
    return {
      deleted: doomed.length,
      added: outcome.added,
      text: 'Weeks replaced',
    };
  }

  private async finish(
    organizationId: string,
    plan: Awaited<ReturnType<WeeksService['plan']>>,
    choices: Choice[],
    clearing: boolean,
    doomed: string[],
  ) {
    if (plan.conflicts.length > 0 && !covers(plan.conflicts, choices)) {
      throw new ApiError({
        statusCode: 409,
        code: 'WEEK_CONFLICTS',
        message: 'Conflicts',
        conflicts: plan.conflicts.map((item) => ({
          rowId: item.occurrence.rowId,
          date: item.occurrence.date,
          classTypeName: item.occurrence.classTypeName,
          start: item.occurrence.startTime,
          end: endClock(
            item.occurrence.startTime,
            item.occurrence.durationMinutes,
          ),
          existing: item.existing.map((row) => ({
            classId: row.class_id,
            reason: row.reason,
            message:
              row.reason === 'hall'
                ? hallBusyText(
                    row.class_type_name,
                    row.start_time.slice(0, 5),
                    endClock(row.start_time.slice(0, 5), row.duration_minutes),
                  )
                : trainerBusyText(
                    row.trainer_name ?? '',
                    row.hall_name,
                    row.start_time.slice(0, 5),
                    endClock(row.start_time.slice(0, 5), row.duration_minutes),
                  ),
            started: row.started,
          })),
        })),
      });
    }
    let added = 0;
    await this.db.transaction(async (tx) => {
      if (clearing) {
        for (const id of doomed) await deleteClass(tx, id);
      }
      const gone = new Set(doomed);
      for (const item of plan.conflicts) {
        const choice = choices.find(
          (entry) =>
            entry.rowId === item.occurrence.rowId &&
            entry.date === item.occurrence.date,
        );
        if (choice?.choice !== 'apply_new') continue;
        const blocking = item.existing.filter((row) => !gone.has(row.class_id));
        if (blocking.some((row) => row.started)) throw alreadyStarted();
        for (const row of blocking) {
          await deleteClass(tx, row.class_id);
          gone.add(row.class_id);
        }
      }
      const creating = [
        ...plan.fresh,
        ...plan.conflicts
          .filter((item) =>
            choices.some(
              (entry) =>
                entry.rowId === item.occurrence.rowId &&
                entry.date === item.occurrence.date &&
                entry.choice === 'apply_new',
            ),
          )
          .map((item) => item.occurrence),
      ];
      for (const item of creating) {
        await insertClass(tx, organizationId, item, item.timeZone);
        added += 1;
      }
    });
    return { added, text: appliedText(added) };
  }

  private async plan(
    organizationId: string,
    templateId: string,
    span: Span,
    ignore: Set<string>,
  ) {
    const rows = await this.rows(organizationId, templateId);
    const occurrences: Occurrence[] = [];
    for (const date of eachDate(span.start, span.end)) {
      const weekday = weekdayOf(date);
      for (const row of rows) {
        if (row.weekday !== weekday) continue;
        const hall = await hallOf(this.db, organizationId, row.hallId);
        if (await isPast(this.db, hall.timeZone, date, row.startTime)) continue;
        occurrences.push({
          ...row,
          date,
          timeZone: hall.timeZone,
          classTypeName: row.classTypeName,
        });
      }
    }
    const existing = (await this.existing(organizationId, span)).filter(
      (row) => !ignore.has(row.id),
    );
    const fresh: Occurrence[] = [];
    const conflicts: {
      occurrence: Occurrence;
      existing: Awaited<ReturnType<typeof listOverlaps>>;
    }[] = [];
    for (const item of occurrences) {
      if (existing.some((row) => same(row, item))) continue;
      const overlaps = await listOverlaps(this.db, item, item.timeZone);
      if (overlaps.length === 0) fresh.push(item);
      else conflicts.push({ occurrence: item, existing: overlaps });
    }
    return { occurrences, fresh, conflicts };
  }

  private async rows(organizationId: string, templateId: string) {
    const templates = await this.db.execute<{ id: string }>(sql`
      select id from week_template where id = ${templateId} and organization_id = ${organizationId}
    `);
    if (!templates.rows[0]) throw ApiError.notFound('Template not found');
    const rows = await this.db.execute<{
      id: string;
      weekday: string;
      start_time: string;
      duration_minutes: number;
      hall_id: string;
      class_type_id: string;
      class_type_name: string;
      audience: ClassFields['audience'];
      format: ClassFields['format'];
      places: number | null;
    }>(sql`
      select r.id, r.weekday, to_char(r.start_time, 'HH24:MI') as start_time,
             r.duration_minutes, r.hall_id, r.class_type_id, ct.name as class_type_name,
             r.audience, r.format, r.places
        from week_template_row r
        join class_type ct on ct.id = r.class_type_id
       where r.template_id = ${templateId}
    `);
    const result = [];
    for (const row of rows.rows) {
      const trainers = await this.db.execute<{ trainer_id: string }>(sql`
        select trainer_id from week_template_row_trainer
         where row_id = ${row.id}
         order by created_at, trainer_id
      `);
      result.push({
        rowId: row.id,
        weekday: row.weekday,
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
        hallId: row.hall_id,
        classTypeId: row.class_type_id,
        classTypeName: row.class_type_name,
        audience: row.audience,
        format: row.format,
        places: row.places,
        trainerIds: trainers.rows.map((trainer) => trainer.trainer_id),
      });
    }
    return result;
  }

  private async existing(organizationId: string, span: Span) {
    const rows = await this.db.execute<{
      hall_id: string;
      date: string;
      start_time: string;
      duration_minutes: number;
      class_type_id: string;
      audience: ClassFields['audience'];
      format: ClassFields['format'];
      places: number | null;
      cancelled: boolean;
      id: string;
    }>(sql`
      select id, hall_id, to_char(date, 'YYYY-MM-DD') as date,
             to_char(start_time, 'HH24:MI') as start_time,
             duration_minutes, class_type_id, audience, format, places, cancelled
        from scheduled_class
       where organization_id = ${organizationId}
         and date between ${span.start}::date and ${span.end}::date
    `);
    const result = [];
    for (const row of rows.rows) {
      const trainers = await this.db.execute<{ trainer_id: string }>(sql`
        select trainer_id from scheduled_class_trainer where class_id = ${row.id}
      `);
      result.push({
        ...row,
        trainerIds: trainers.rows.map((trainer) => trainer.trainer_id),
      });
    }
    return result;
  }

  private async clearable(
    organizationId: string,
    span: Span,
    hallIds: string[] | null,
  ): Promise<string[]> {
    const halls =
      hallIds === null
        ? sql``
        : sql`and hall_id in (${sql.join(
            hallIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from scheduled_class
       where organization_id = ${organizationId}
         and date between ${span.start}::date and ${span.end}::date
         and starts_at > now()
         ${halls}
    `);
    return rows.rows.map((row) => row.id);
  }

  private async span(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<Span> {
    const today = await studioToday(this.db, organizationId);
    const start = mondayOf(from);
    const end = addDays(mondayOf(to), 6);
    if (start < mondayOf(today)) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'from',
          message: 'Choose a week from the current week',
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
    return { start, end };
  }

  private async assertHalls(organizationId: string, hallIds: string[] | null) {
    if (hallIds === null) return;
    if (hallIds.length === 0) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'hallIds',
          message: 'Choose halls, or omit the list for every hall',
        },
      ]);
    }
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from hall
       where organization_id = ${organizationId}
         and id in (${sql.join(
           hallIds.map((id) => sql`${id}`),
           sql`, `,
         )})
    `);
    if (rows.rows.length !== hallIds.length) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'hallIds',
          message: 'Choose halls of this studio',
        },
      ]);
    }
  }

  private async writer(session: StudioSessionInfo) {
    const actor = await openSchedule(this.access, this.db, session);
    assertWriter(actor.role);
  }
}

interface Span {
  start: string;
  end: string;
}

function same(
  existing: {
    hall_id: string;
    date: string;
    start_time: string;
    duration_minutes: number;
    class_type_id: string;
    audience: string;
    format: string;
    places: number | null;
    trainerIds: string[];
  },
  item: ClassFields,
): boolean {
  return (
    existing.hall_id === item.hallId &&
    existing.date === item.date &&
    existing.start_time === item.startTime &&
    existing.duration_minutes === item.durationMinutes &&
    existing.class_type_id === item.classTypeId &&
    existing.audience === item.audience &&
    existing.format === item.format &&
    existing.places === item.places &&
    sameSet(existing.trainerIds, item.trainerIds)
  );
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((id) => values.has(id));
}

function covers(
  conflicts: { occurrence: { rowId: string; date: string } }[],
  choices: Choice[],
): boolean {
  return conflicts.every((item) =>
    choices.some(
      (choice) =>
        choice.rowId === item.occurrence.rowId &&
        choice.date === item.occurrence.date &&
        (choice.choice === 'keep_existing' || choice.choice === 'apply_new'),
    ),
  );
}

function alreadyStarted(): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'CLASS_ALREADY_STARTED',
    message: 'The class has already started',
  });
}
