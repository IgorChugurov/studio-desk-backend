import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import type {
  BillingConfig,
  ScheduleConfig,
  Section,
} from '../../../common/organization-config.js';
import {
  type Database,
  PLATFORM_DB,
} from '../../../database/database.module.js';
import { preset } from '../../../database/schema/index.js';

export interface PresetWrite {
  name?: string;
  description?: string | null;
  sections?: Section[];
  catalogConfig?: { resourceTypes: unknown[] };
  scheduleConfig?: ScheduleConfig;
  billingConfig?: BillingConfig;
}

interface PresetRow {
  id: string;
  name: string;
  description: string | null;
  sections: Section[];
  catalog_config: { resourceTypes: unknown[] };
  schedule_config: ScheduleConfig;
  billing_config: BillingConfig;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PresetsService {
  constructor(@Inject(PLATFORM_DB) private readonly db: Database) {}

  async list(query: {
    currentPage: number;
    perPage: number;
    search?: string;
    sortBy: 'createdAt' | 'name';
    order: 'ASC' | 'DESC';
  }) {
    const pattern = query.search ? likePattern(query.search) : undefined;
    const direction = query.order === 'ASC' ? sql`asc` : sql`desc`;
    const sort = query.sortBy === 'name' ? sql`name` : sql`created_at`;
    const where = pattern ? sql`name ilike ${pattern} escape '\\'` : sql`true`;
    const total = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from preset where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const rows = await this.db.execute(sql`
      select id, name, description, sections, catalog_config, schedule_config,
             billing_config, created_at, updated_at
        from preset
       where ${where}
       order by ${sort} ${direction}, id ${direction}
       limit ${query.perPage}
      offset ${offset}
    `);
    return page(
      query.currentPage,
      query.perPage,
      totalItems,
      rows.rows as unknown as PresetRow[],
    );
  }

  async create(
    input: Required<Omit<PresetWrite, 'description'>> & PresetWrite,
  ) {
    try {
      const inserted = await this.db
        .insert(preset)
        .values({
          name: input.name!,
          description: input.description ?? null,
          sections: input.sections,
          catalogConfig: input.catalogConfig,
          scheduleConfig: input.scheduleConfig,
          billingConfig: input.billingConfig,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('preset was not created');
      return toPreset(fromDrizzle(row));
    } catch (error) {
      const taken = nameTaken(error);
      if (taken) throw taken;
      throw error;
    }
  }

  async get(id: string) {
    const rows = await this.db.execute(
      sql`select id, name, description, sections, catalog_config, schedule_config,
                 billing_config, created_at, updated_at
            from preset where id = ${id}`,
    );
    const row = rows.rows[0] as PresetRow | undefined;
    if (!row) throw ApiError.notFound('Preset not found');
    return toPreset(row);
  }

  async update(id: string, patch: PresetWrite) {
    const current = await this.get(id);
    const next = {
      name: patch.name ?? current.name,
      description:
        patch.description === undefined
          ? current.description
          : patch.description,
      sections: patch.sections ?? current.sections,
      catalogConfig: patch.catalogConfig ?? current.catalogConfig,
      scheduleConfig: patch.scheduleConfig ?? current.scheduleConfig,
      billingConfig: patch.billingConfig ?? current.billingConfig,
    };
    try {
      const updated = await this.db
        .update(preset)
        .set({ ...next, updatedAt: new Date() })
        .where(sql`${preset.id} = ${id}`)
        .returning();
      const row = updated[0];
      if (!row) throw ApiError.notFound('Preset not found');
      return toPreset(fromDrizzle(row));
    } catch (error) {
      const taken = nameTaken(error);
      if (taken) throw taken;
      throw error;
    }
  }

  async duplicate(id: string) {
    const current = await this.get(id);
    const names = await this.db.execute<{ name: string }>(
      sql`select name from preset`,
    );
    const taken = new Set(names.rows.map((row) => row.name));
    const name = copyName(current.name, taken);
    return this.create({
      name,
      description: current.description,
      sections: current.sections,
      catalogConfig: current.catalogConfig,
      scheduleConfig: current.scheduleConfig,
      billingConfig: current.billingConfig,
    });
  }

  async remove(id: string) {
    const deleted = await this.db
      .delete(preset)
      .where(sql`${preset.id} = ${id}`)
      .returning({ id: preset.id });
    if (deleted.length === 0) throw ApiError.notFound('Preset not found');
  }
}

function page(
  currentPage: number,
  perPage: number,
  totalItems: number,
  rows: PresetRow[],
) {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / perPage);
  return {
    items: rows.map(toPreset),
    meta: {
      currentPage,
      perPage,
      totalItems,
      totalPages,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages,
    },
  };
}

function toPreset(row: PresetRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sections: row.sections,
    catalogConfig: row.catalog_config,
    scheduleConfig: row.schedule_config,
    billingConfig: row.billing_config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromDrizzle(row: {
  id: string;
  name: string;
  description: string | null;
  sections: unknown;
  catalogConfig: unknown;
  scheduleConfig: unknown;
  billingConfig: unknown;
  createdAt: Date;
  updatedAt: Date;
}): PresetRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sections: row.sections as Section[],
    catalog_config: row.catalogConfig as PresetRow['catalog_config'],
    schedule_config: row.scheduleConfig as ScheduleConfig,
    billing_config: row.billingConfig as BillingConfig,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function copyName(name: string, taken: Set<string>) {
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' (copy)' : ` (copy ${index})`;
    const room = 100 - suffix.length;
    const base = name.length <= room ? name : name.slice(0, room).trimEnd();
    const candidate = `${base.length >= 2 ? base : name.slice(0, room)}${suffix}`;
    if (candidate.length <= 100 && !taken.has(candidate)) return candidate;
  }
  throw new Error('preset copy name was not found');
}

function nameTaken(error: unknown) {
  if (uniqueConstraint(error) !== 'preset_name_unique') return undefined;
  return new ApiError({
    statusCode: 409,
    code: 'PRESET_NAME_TAKEN',
    message: 'This preset name is already taken',
    field: 'name',
  });
}

function uniqueConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if (
      'code' in current &&
      current.code === '23505' &&
      'constraint' in current &&
      typeof current.constraint === 'string'
    ) {
      return current.constraint;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
