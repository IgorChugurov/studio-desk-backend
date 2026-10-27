import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { assertWriter, openSchedule } from './schedule-access.js';
import type { TimeConflict } from './schedule-db.js';
import {
  deleteSlot,
  findConflicts,
  insertSlot,
  isPast,
  loadCatalog,
  studioToday,
} from './schedule-db.js';
import {
  addDays,
  appliedText,
  busyMessage,
  clearPreviewText,
  eachDate,
  endClock,
  mondayOf,
  replacePreviewText,
  weekdayOf,
} from './schedule-time.js';
import type { SlotFields, SlotKind } from './schedule-validate.js';
import { slotTitle } from './schedule-validate.js';

interface Choice {
  rowId: string;
  date: string;
  choice: 'keep_existing' | 'apply_new';
}

interface Occurrence extends SlotFields {
  rowId: string;
  date: string;
  timeZone: string;
  title: string;
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
      placeResourceIds: string[] | null;
      preview: boolean;
    },
  ) {
    await this.writer(session);
    const span = await this.span(session.organizationId, input.from, input.to);
    await this.assertPlaces(session.organizationId, input.placeResourceIds);
    const ids = await this.clearable(
      session.organizationId,
      span,
      input.placeResourceIds,
    );
    if (input.preview) {
      return { deleted: ids.length, text: clearPreviewText(ids.length) };
    }
    await this.db.transaction(async (tx) => {
      for (const id of ids) await deleteSlot(tx, id);
    });
    return { deleted: ids.length, text: 'Weeks cleared' };
  }

  async replace(
    session: StudioSessionInfo,
    input: {
      templateId: string;
      from: string;
      to: string;
      clear: 'template_places' | 'all_places';
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
    const placeResourceIds =
      input.clear === 'all_places'
        ? null
        : [...new Set(draft.occurrences.map((item) => item.placeResourceId))];
    const doomed = await this.clearable(
      session.organizationId,
      span,
      placeResourceIds,
    );
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
          title: item.occurrence.title,
          start: item.occurrence.startTime,
          end: endClock(
            item.occurrence.startTime,
            item.occurrence.durationMinutes,
          ),
          existing: item.existing.map((row) => ({
            slotId: row.slotId,
            resourceId: row.resourceId,
            resourceName: row.resourceName,
            message: busyMessage(row),
            started: row.started,
          })),
        })),
      });
    }
    let added = 0;
    await this.db.transaction(async (tx) => {
      if (clearing) {
        for (const id of doomed) await deleteSlot(tx, id);
      }
      const gone = new Set(doomed);
      for (const item of plan.conflicts) {
        const choice = choices.find(
          (entry) =>
            entry.rowId === item.occurrence.rowId &&
            entry.date === item.occurrence.date,
        );
        if (choice?.choice !== 'apply_new') continue;
        const blocking = item.existing.filter((row) => !gone.has(row.slotId));
        if (blocking.some((row) => row.started)) throw alreadyStarted();
        for (const row of blocking) {
          await deleteSlot(tx, row.slotId);
          gone.add(row.slotId);
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
      const catalog = await loadCatalog(tx, organizationId);
      for (const item of creating) {
        const links = [item.placeResourceId, ...item.resourceIds].flatMap(
          (id) => {
            const resource = catalog.resources.get(id);
            return resource ? [resource] : [];
          },
        );
        await insertSlot(tx, organizationId, item, item.timeZone, links, true);
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
        const places = await this.db.execute<{ time_zone: string }>(sql`
          select time_zone from resource where id = ${row.placeResourceId}
        `);
        const timeZone = places.rows[0]?.time_zone;
        if (!timeZone) continue;
        if (await isPast(this.db, timeZone, date, row.startTime)) continue;
        occurrences.push({ ...row, date, timeZone });
      }
    }
    const existing = (await this.existing(organizationId, span)).filter(
      (row) => !ignore.has(row.id),
    );
    const fresh: Occurrence[] = [];
    const conflicts: { occurrence: Occurrence; existing: TimeConflict[] }[] =
      [];
    for (const item of occurrences) {
      if (existing.some((row) => same(row, item))) continue;
      const found = await findConflicts(
        this.db,
        organizationId,
        item,
        item.timeZone,
        null,
        [...ignore],
      );
      const overlaps = [
        ...(found.strict ? [found.strict] : []),
        ...found.warnings,
      ];
      if (overlaps.length === 0) fresh.push(item);
      else conflicts.push({ occurrence: item, existing: overlaps });
    }
    return { occurrences, fresh, conflicts };
  }

  private async rows(organizationId: string, templateId: string) {
    const templates = await this.db.execute<{ id: string }>(sql`
      select id from week_template
       where id = ${templateId} and organization_id = ${organizationId}
    `);
    if (!templates.rows[0]) throw ApiError.notFound('Template not found');
    const rows = await this.db.execute<{
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
       where template_id = ${templateId}
    `);
    const result = [];
    for (const row of rows.rows) {
      const links = await this.db.execute<{
        resource_id: string;
        name: string;
        role: string;
      }>(sql`
        select link.resource_id, r.name, t.role
          from week_template_row_resource link
          join resource r on r.id = link.resource_id
          join organization_resource_type t on t.id = r.resource_type_id
         where link.row_id = ${row.id}
         order by link.created_at, link.resource_id
      `);
      const resourceIds = links.rows.map((link) => link.resource_id);
      const offerings = links.rows
        .filter((link) => link.role === 'offering')
        .map((link) => link.name);
      result.push({
        rowId: row.id,
        kind: row.kind,
        weekday: row.weekday,
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
        placeResourceId: row.place_resource_id,
        resourceIds,
        audience: row.audience,
        format: row.format,
        places: row.places,
        note: row.note,
        blocksAll: row.blocks_all,
        title: slotTitle(row.kind, offerings, row.note),
      });
    }
    return result;
  }

  private async existing(organizationId: string, span: Span) {
    const rows = await this.db.execute<{
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
    }>(sql`
      select id, kind, place_resource_id, to_char(date, 'YYYY-MM-DD') as date,
             to_char(start_time, 'HH24:MI') as start_time, duration_minutes,
             audience, format, places, note, blocks_all
        from schedule_slot
       where organization_id = ${organizationId}
         and date between ${span.start}::date and ${span.end}::date
    `);
    const result = [];
    for (const row of rows.rows) {
      const links = await this.db.execute<{ resource_id: string }>(sql`
        select resource_id from schedule_slot_resource
         where slot_id = ${row.id} and role <> 'place'
      `);
      result.push({
        ...row,
        resourceIds: links.rows.map((link) => link.resource_id),
      });
    }
    return result;
  }

  private async clearable(
    organizationId: string,
    span: Span,
    placeResourceIds: string[] | null,
  ): Promise<string[]> {
    if (placeResourceIds !== null && placeResourceIds.length === 0) return [];
    const places =
      placeResourceIds === null
        ? sql``
        : sql`and place_resource_id in (${sql.join(
            placeResourceIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from schedule_slot
       where organization_id = ${organizationId}
         and date between ${span.start}::date and ${span.end}::date
         and starts_at > now()
         ${places}
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

  private async assertPlaces(
    organizationId: string,
    placeResourceIds: string[] | null,
  ) {
    if (placeResourceIds === null) return;
    if (placeResourceIds.length === 0) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'placeResourceIds',
          message: 'Choose places, or omit the list for every place',
        },
      ]);
    }
    const rows = await this.db.execute<{ id: string }>(sql`
      select r.id
        from resource r
        join organization_resource_type t on t.id = r.resource_type_id
       where r.organization_id = ${organizationId}
         and t.role = 'place'
         and r.id in (${sql.join(
           placeResourceIds.map((id) => sql`${id}`),
           sql`, `,
         )})
    `);
    if (rows.rows.length !== placeResourceIds.length) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'placeResourceIds',
          message: 'Choose places of this organization',
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
    resourceIds: string[];
  },
  item: Occurrence,
): boolean {
  return (
    existing.kind === item.kind &&
    existing.place_resource_id === item.placeResourceId &&
    existing.date === item.date &&
    existing.start_time === item.startTime &&
    existing.duration_minutes === item.durationMinutes &&
    existing.audience === item.audience &&
    existing.format === item.format &&
    existing.places === item.places &&
    existing.note === item.note &&
    existing.blocks_all === item.blocksAll &&
    sameSet(existing.resourceIds, item.resourceIds)
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
    code: 'SLOT_ALREADY_STARTED',
    message: 'The slot has already started',
  });
}
