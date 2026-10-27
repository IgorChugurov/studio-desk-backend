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
import type { SlotStatus, SlotView } from './schedule-db.js';
import {
  deleteSlot,
  findConflicts,
  insertSlot,
  isPast,
  loadCatalog,
  occupiesOf,
  readScheduleConfig,
  readSlot,
  retryDeadlock,
  rewriteSlot,
  writeStatus,
} from './schedule-db.js';
import {
  addDays,
  busyMessage,
  inclusiveDays,
  mondayOf,
} from './schedule-time.js';
import {
  type CatalogResource,
  offeringIds,
  prepareSlot,
  type SlotDraft,
  type SlotFields,
} from './schedule-validate.js';

type CreateInput = SlotDraft & {
  date: string;
  confirmOverlap?: boolean;
};

type PatchInput = {
  placeResourceId?: string;
  resourceIds?: string[];
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  audience?: SlotFields['audience'];
  format?: SlotFields['format'];
  places?: number | null;
  note?: string | null;
  blocksAll?: boolean;
  status?: SlotStatus;
  confirmOverlap?: boolean;
};

@Injectable()
export class ScheduleSlotsService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async list(
    session: StudioSessionInfo,
    query: { from: string; to: string; resourceId?: string },
  ) {
    const actor = await openSchedule(this.access, this.db, session);
    if (
      actor.resourceId &&
      query.resourceId &&
      query.resourceId !== actor.resourceId
    ) {
      throw pageForbidden();
    }
    const start = mondayOf(query.from);
    const end = addDays(mondayOf(query.to), 6);
    if (inclusiveDays(start, end) > 366) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'from',
          message: 'Choose a range within a year',
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
    if (query.resourceId) {
      await this.resourceInOrganization(
        session.organizationId,
        query.resourceId,
      );
    }
    const rows = await this.db.execute<{ id: string }>(sql`
      select s.id
        from schedule_slot s
       where s.organization_id = ${session.organizationId}
         and s.date between ${start}::date and ${end}::date
         ${
           query.resourceId
             ? sql`and (
                 s.blocks_all
                 or s.place_resource_id = ${query.resourceId}
                 or exists (
                   select 1 from schedule_slot_resource link
                    where link.slot_id = s.id
                      and link.resource_id = ${query.resourceId}
                 )
               )`
             : sql``
         }
         ${
           actor.resourceId
             ? sql`and (
                 s.blocks_all
                 or exists (
                   select 1 from schedule_slot_resource link
                    where link.slot_id = s.id
                      and link.resource_id = ${actor.resourceId}
                 )
               )`
             : sql``
         }
       order by s.date, s.start_time, s.id
    `);
    const items: SlotView[] = [];
    for (const row of rows.rows) {
      const item = await readSlot(this.db, row.id);
      if (item) items.push(item);
    }
    return { items };
  }

  async get(session: StudioSessionInfo, id: string) {
    const actor = await openSchedule(this.access, this.db, session);
    const item = await this.inOrganization(session.organizationId, id);
    if (actor.resourceId && !visibleTo(item, actor.resourceId)) {
      throw ApiError.notFound('Slot not found');
    }
    return item;
  }

  async create(session: StudioSessionInfo, input: CreateInput) {
    await this.writer(session);
    const prepared = await this.prepare(session.organizationId, input);
    if (
      await isPast(this.db, prepared.timeZone, input.date, prepared.startTime)
    ) {
      throw alreadyStarted();
    }
    const id = await retryDeadlock(() =>
      this.db.transaction((tx) =>
        insertSlot(
          tx,
          session.organizationId,
          { ...prepared, date: input.date },
          prepared.timeZone,
          prepared.links,
          input.confirmOverlap === true,
        ),
      ),
    );
    return readSlot(this.db, id);
  }

  async update(session: StudioSessionInfo, id: string, patch: PatchInput) {
    await this.writer(session);
    const current = await this.inOrganization(session.organizationId, id);
    const catalog = await loadCatalog(this.db, session.organizationId);
    const place = catalog.resources.get(current.placeResourceId);
    const zone = place?.timeZone ?? 'UTC';
    const past = await isPast(this.db, zone, current.date, current.startTime);
    if (past) return this.updatePast(session.organizationId, current, patch);
    if (!current.occupiesResources) throw inactive(current.status);
    const next = merge(current, patch);
    if (
      current.kind === 'service' &&
      patch.resourceIds &&
      offeringsChanged(
        current.resourceIds,
        patch.resourceIds,
        catalog.resources,
      )
    ) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'resourceIds',
          message: 'Change the offering with replace',
        },
      ]);
    }
    const prepared = await this.prepare(session.organizationId, {
      ...next,
      placeResourceId: next.placeResourceId,
    });
    if (
      await isPast(this.db, prepared.timeZone, next.date, prepared.startTime)
    ) {
      throw alreadyStarted();
    }
    const status = await this.nextStatus(
      session.organizationId,
      current,
      patch.status,
    );
    await this.db.transaction(async (tx) => {
      await rewriteSlot(
        tx,
        session.organizationId,
        id,
        { ...prepared, date: next.date, status },
        prepared.timeZone,
        prepared.links,
        patch.confirmOverlap === true,
      );
    });
    return readSlot(this.db, id);
  }

  async cancel(session: StudioSessionInfo, id: string) {
    await this.writer(session);
    const current = await this.inOrganization(session.organizationId, id);
    await this.assertFuture(current);
    if (!current.occupiesResources) throw inactive(current.status);
    await this.db.transaction(async (tx) => writeStatus(tx, id, 'cancelled'));
    return readSlot(this.db, id);
  }

  async restore(
    session: StudioSessionInfo,
    id: string,
    confirmOverlap: boolean,
  ) {
    await this.writer(session);
    const current = await this.inOrganization(session.organizationId, id);
    await this.assertFuture(current);
    if (current.occupiesResources) {
      throw new ApiError({
        statusCode: 409,
        code: 'NOT_CANCELLED',
        message: 'The slot is not inactive',
      });
    }
    const catalog = await loadCatalog(this.db, session.organizationId);
    const place = catalog.resources.get(current.placeResourceId);
    if (!place?.timeZone) throw ApiError.notFound('Slot not found');
    const found = await findConflicts(
      this.db,
      session.organizationId,
      current,
      place.timeZone,
      id,
    );
    if (found.strict) throw resourceBusy(found.strict);
    if (found.warnings.length > 0 && !confirmOverlap) {
      throw new ApiError({
        statusCode: 409,
        code: 'OVERLAP_WARNING',
        message: 'This time overlaps another slot',
        conflicts: found.warnings,
      });
    }
    const zone = place.timeZone;
    await this.db.transaction(async (tx) => {
      try {
        await writeStatus(tx, id, 'planned');
      } catch (error) {
        const again = await findConflicts(
          tx,
          session.organizationId,
          current,
          zone,
          id,
        );
        if (again.strict) throw resourceBusy(again.strict);
        throw error;
      }
    });
    return readSlot(this.db, id);
  }

  async remove(session: StudioSessionInfo, id: string) {
    await this.writer(session);
    const current = await this.inOrganization(session.organizationId, id);
    await this.assertFuture(current);
    await deleteSlot(this.db, id);
  }

  async replace(session: StudioSessionInfo, id: string, input: CreateInput) {
    await this.writer(session);
    const current = await this.inOrganization(session.organizationId, id);
    if (current.kind !== 'service' || input.kind !== 'service') {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'kind',
          message: 'Replace a service slot',
        },
      ]);
    }
    await this.assertFuture(current);
    if (!current.occupiesResources) throw inactive(current.status);
    const prepared = await this.prepare(session.organizationId, input);
    if (
      await isPast(this.db, prepared.timeZone, input.date, prepared.startTime)
    ) {
      throw alreadyStarted();
    }
    const created = await this.db.transaction(async (tx) => {
      await writeStatus(tx, id, 'cancelled');
      return insertSlot(
        tx,
        session.organizationId,
        { ...prepared, date: input.date },
        prepared.timeZone,
        prepared.links,
        input.confirmOverlap === true,
      );
    });
    return readSlot(this.db, created);
  }

  private async updatePast(
    organizationId: string,
    current: SlotView,
    patch: PatchInput,
  ) {
    if (frozenChanged(current, patch)) throw alreadyStarted();
    if (patch.status === undefined || patch.status === current.status) {
      return current;
    }
    if (current.kind !== 'service') throw alreadyStarted();
    if (patch.status !== 'completed' && patch.status !== 'no_show') {
      throw alreadyStarted();
    }
    const config = await readScheduleConfig(this.db, organizationId);
    if (!config.statuses.includes(patch.status)) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'status',
          message: 'Choose a status this organization uses',
        },
      ]);
    }
    const next = patch.status;
    if (occupiesOf(next) && !current.occupiesResources) {
      const catalog = await loadCatalog(this.db, organizationId);
      const place = catalog.resources.get(current.placeResourceId);
      if (!place?.timeZone) throw ApiError.notFound('Slot not found');
      const found = await findConflicts(
        this.db,
        organizationId,
        current,
        place.timeZone,
        current.id,
      );
      if (found.strict) throw resourceBusy(found.strict);
      if (found.warnings.length > 0 && patch.confirmOverlap !== true) {
        throw new ApiError({
          statusCode: 409,
          code: 'OVERLAP_WARNING',
          message: 'This time overlaps another slot',
          conflicts: found.warnings,
        });
      }
    }
    await this.db.transaction(async (tx) => writeStatus(tx, current.id, next));
    return readSlot(this.db, current.id);
  }

  private async nextStatus(
    organizationId: string,
    current: SlotView,
    status: SlotStatus | undefined,
  ): Promise<SlotStatus> {
    const next = status ?? current.status;
    if (next === current.status) return next;
    const config = await readScheduleConfig(this.db, organizationId);
    if (!config.statuses.includes(next)) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'status',
          message: 'Choose a status this organization uses',
        },
      ]);
    }
    if (
      current.kind === 'block' &&
      next !== 'planned' &&
      next !== 'cancelled'
    ) {
      throw ApiError.validation([
        {
          code: FieldErrorCode.INVALID_VALUE,
          field: 'status',
          message: 'A block uses planned or cancelled',
        },
      ]);
    }
    return next;
  }

  private async prepare(organizationId: string, input: SlotDraft) {
    const [catalog, config] = await Promise.all([
      loadCatalog(this.db, organizationId),
      readScheduleConfig(this.db, organizationId),
    ]);
    const prepared = prepareSlot(
      { ...input, resourceIds: input.resourceIds ?? [] },
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

  private async assertFuture(current: SlotView) {
    const rows = await this.db.execute<{ time_zone: string }>(sql`
      select time_zone from resource where id = ${current.placeResourceId}
    `);
    const zone = rows.rows[0]?.time_zone ?? 'UTC';
    if (await isPast(this.db, zone, current.date, current.startTime)) {
      throw alreadyStarted();
    }
  }

  private async inOrganization(
    organizationId: string,
    id: string,
  ): Promise<SlotView> {
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from schedule_slot
       where id = ${id} and organization_id = ${organizationId}
    `);
    if (!rows.rows[0]) throw ApiError.notFound('Slot not found');
    const item = await readSlot(this.db, id);
    if (!item) throw ApiError.notFound('Slot not found');
    return item;
  }

  private async resourceInOrganization(
    organizationId: string,
    resourceId: string,
  ) {
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from resource
       where id = ${resourceId} and organization_id = ${organizationId}
    `);
    if (!rows.rows[0]) throw ApiError.notFound('Resource not found');
  }

  private async writer(session: StudioSessionInfo) {
    const actor = await openSchedule(this.access, this.db, session);
    assertWriter(actor.role);
  }
}

function visibleTo(slot: SlotView, resourceId: string): boolean {
  return (
    slot.blocksAll ||
    slot.placeResourceId === resourceId ||
    slot.resourceIds.includes(resourceId)
  );
}

function merge(
  current: SlotView,
  patch: PatchInput,
): SlotFields & { date: string } {
  return {
    kind: current.kind,
    placeResourceId: patch.placeResourceId ?? current.placeResourceId,
    resourceIds: patch.resourceIds ?? current.resourceIds,
    date: patch.date ?? current.date,
    startTime: patch.startTime ?? current.startTime,
    durationMinutes: patch.durationMinutes ?? current.durationMinutes,
    audience: patch.audience === undefined ? current.audience : patch.audience,
    format: patch.format === undefined ? current.format : patch.format,
    places: patch.places === undefined ? current.places : patch.places,
    note: patch.note === undefined ? current.note : patch.note,
    blocksAll: patch.blocksAll ?? current.blocksAll,
  };
}

function frozenChanged(current: SlotView, patch: PatchInput): boolean {
  const next = merge(current, patch);
  return (
    next.placeResourceId !== current.placeResourceId ||
    !sameIds(next.resourceIds, current.resourceIds) ||
    next.date !== current.date ||
    next.startTime !== current.startTime ||
    next.durationMinutes !== current.durationMinutes ||
    next.audience !== current.audience ||
    next.format !== current.format ||
    next.places !== current.places ||
    next.note !== current.note ||
    next.blocksAll !== current.blocksAll
  );
}

function offeringsChanged(
  current: string[],
  next: string[],
  resources: Map<string, CatalogResource>,
): boolean {
  const left = offeringIds(current, resources);
  const right = offeringIds(next, resources);
  return !sameIds(left, right);
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((id) => values.has(id));
}

function resourceBusy(conflict: {
  resourceId: string;
  resourceName: string;
  start: string;
  end: string;
  title: string;
  slotId?: string;
}): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'RESOURCE_BUSY',
    message: busyMessage(conflict),
    conflict,
  });
}

function alreadyStarted(): ApiError {
  return new ApiError({
    statusCode: 409,
    code: 'SLOT_ALREADY_STARTED',
    message: 'The slot has already started',
  });
}

function inactive(status: SlotStatus): ApiError {
  if (status === 'cancelled') {
    return new ApiError({
      statusCode: 409,
      code: 'SLOT_CANCELLED',
      message: 'The slot is cancelled',
    });
  }
  return new ApiError({
    statusCode: 409,
    code: 'SLOT_INACTIVE',
    message: 'The slot is inactive',
  });
}
