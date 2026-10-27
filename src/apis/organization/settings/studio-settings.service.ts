import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import type {
  BillingConfig,
  ResourceTypeFields,
  ScheduleConfig,
} from '../../../common/organization-config.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  classType,
  currency,
  hall,
  organization,
  organizationResourceType,
  staffTrainer,
  trainer,
} from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { readOrganizationConfig } from '../organization-view.js';
import {
  COUNTRIES,
  TIME_ZONES,
  type StudioSettings,
} from './organization-settings.js';

type IncomingType = ResourceTypeFields & { id?: string };

type Patch = {
  language?: string;
  country?: string;
  currency?: string;
  timeZone?: string;
  catalogConfig?: { resourceTypes: IncomingType[] };
  scheduleConfig?: ScheduleConfig;
  billingConfig?: BillingConfig;
};

@Injectable()
export class StudioSettingsService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async get(session: StudioSessionInfo): Promise<StudioSettings> {
    await this.access.assertSection(session, 'organization-settings');
    return this.read(session.organizationId);
  }

  async options(session: StudioSessionInfo) {
    await this.access.assertSection(session, 'organization-settings');
    const rows = await this.db
      .select({ code: currency.code })
      .from(currency)
      .orderBy(currency.code);
    return {
      countries: COUNTRIES,
      currencies: rows.map((row) => row.code),
      timeZones: TIME_ZONES,
    };
  }

  async update(
    session: StudioSessionInfo,
    patch: Patch,
  ): Promise<StudioSettings> {
    await this.access.assertSection(session, 'organization-settings');
    if (patch.currency !== undefined) {
      const found = await this.db
        .select({ code: currency.code })
        .from(currency)
        .where(eq(currency.code, patch.currency));
      if (found.length === 0) {
        throw ApiError.validation([
          {
            code: 'INVALID_VALUE',
            field: 'currency',
            message: 'Choose a currency',
          },
        ]);
      }
    }
    if (patch.catalogConfig) {
      await this.replaceResourceTypes(
        session.organizationId,
        patch.catalogConfig.resourceTypes,
      );
    }
    const values = {
      ...(patch.language === undefined ? {} : { language: patch.language }),
      ...(patch.country === undefined ? {} : { country: patch.country }),
      ...(patch.currency === undefined ? {} : { currency: patch.currency }),
      ...(patch.timeZone === undefined ? {} : { timeZone: patch.timeZone }),
      ...(patch.scheduleConfig === undefined
        ? {}
        : { scheduleConfig: patch.scheduleConfig }),
      ...(patch.billingConfig === undefined
        ? {}
        : { billingConfig: patch.billingConfig }),
    };
    if (Object.keys(values).length > 0) {
      await this.db
        .update(organization)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(organization.id, session.organizationId));
    }
    return this.read(session.organizationId);
  }

  private async read(organizationId: string): Promise<StudioSettings> {
    const rows = await this.db
      .select({
        language: organization.language,
        country: organization.country,
        currency: organization.currency,
        timeZone: organization.timeZone,
      })
      .from(organization)
      .where(eq(organization.id, organizationId));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Organization not found');
    const config = await readOrganizationConfig(this.db, organizationId);
    return { ...row, ...config };
  }

  /**
   * Stage 1 still stores halls, trainers and class types in their own tables.
   * A place type is in use when the organization has a hall, an offering when
   * it has a class type, and a person type when it has a trainer or a staff link.
   */
  private async replaceResourceTypes(
    organizationId: string,
    next: IncomingType[],
  ) {
    const existing = await this.db
      .select()
      .from(organizationResourceType)
      .where(eq(organizationResourceType.organizationId, organizationId));
    const byId = new Map(existing.map((row) => [row.id, row]));
    for (const type of next) {
      if (type.id && !byId.has(type.id)) {
        throw ApiError.validation([
          {
            code: 'INVALID_VALUE',
            field: 'catalogConfig.resourceTypes',
            message: 'Unknown resource type',
          },
        ]);
      }
    }
    const nextIds = new Set(next.flatMap((type) => (type.id ? [type.id] : [])));
    const removed = existing.filter((row) => !nextIds.has(row.id));
    const personDisabled = next.filter((type) => {
      const current = type.id ? byId.get(type.id) : undefined;
      return current?.person === true && type.person === false;
    });
    if (removed.length > 0 || personDisabled.length > 0) {
      const usage = await this.usage(organizationId);
      const blocked =
        removed.some(
          (row) =>
            (row.role === 'place' && usage.halls > 0) ||
            (row.role === 'offering' && usage.classTypes > 0) ||
            (row.person && (usage.trainers > 0 || usage.staffLinks > 0)),
        ) ||
        (personDisabled.length > 0 && usage.staffLinks > 0);
      if (blocked) {
        throw new ApiError({
          statusCode: 409,
          code: 'RESOURCE_TYPE_IN_USE',
          message: 'This resource type is already used',
          field: 'catalogConfig.resourceTypes',
        });
      }
    }
    await this.db.transaction(async (tx) => {
      await tx
        .delete(organizationResourceType)
        .where(eq(organizationResourceType.organizationId, organizationId));
      for (let index = 0; index < next.length; index += 1) {
        const type = next[index]!;
        await tx.insert(organizationResourceType).values({
          ...(type.id ? { id: type.id } : {}),
          organizationId,
          sortOrder: index,
          role: type.role,
          labels: type.labels,
          geography: type.geography,
          duration: type.duration,
          showcase: type.showcase,
          person: type.person,
          skills: type.skills,
          required: type.required,
          multiple: type.multiple,
          conflictMode: type.conflictMode,
        });
      }
    });
  }

  private async usage(organizationId: string) {
    const [halls, trainers, classTypes, staffLinks] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(hall)
        .where(eq(hall.organizationId, organizationId)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(trainer)
        .where(eq(trainer.organizationId, organizationId)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(classType)
        .where(eq(classType.organizationId, organizationId)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(staffTrainer)
        .where(eq(staffTrainer.organizationId, organizationId)),
    ]);
    return {
      halls: halls[0]?.total ?? 0,
      trainers: trainers[0]?.total ?? 0,
      classTypes: classTypes[0]?.total ?? 0,
      staffLinks: staffLinks[0]?.total ?? 0,
    };
  }
}
