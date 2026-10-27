import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import {
  orderSections,
  type ResourceTypeFields,
  type Section,
} from '../../../common/organization-config.js';
import {
  type Database,
  PLATFORM_DB,
} from '../../../database/database.module.js';
import {
  handoffCode,
  organization,
  organizationResourceType,
  organizationSection,
} from '../../../database/schema/index.js';
import {
  HANDOFF_CODE_TTL_SECONDS,
  newHandoffCode,
  sha256,
} from '../../../common/auth/tokens.js';

const RESERVED_SUBDOMAINS = ['api', 'admin', 'app', 'www'] as const;

export interface StudioInput {
  name: string;
  subdomain: string;
  customDomain?: string | null;
  ownerEmail: string;
  presetId?: string;
  sections?: Section[];
}

export interface StudioRecord {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  ownerEmail: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class StudiosService {
  constructor(@Inject(PLATFORM_DB) private readonly db: Database) {}

  async list(query: {
    currentPage: number;
    perPage: number;
    search?: string;
    order: 'ASC' | 'DESC';
    status: 'active' | 'deactivated';
  }) {
    const pattern = query.search ? likePattern(query.search) : undefined;
    const direction = query.order === 'ASC' ? sql`asc` : sql`desc`;
    const where = sql`
      status = ${query.status}
      ${
        pattern
          ? sql`and (
              name ilike ${pattern} escape '\\'
              or subdomain ilike ${pattern} escape '\\'
              or custom_domain ilike ${pattern} escape '\\'
              or owner_email ilike ${pattern} escape '\\'
            )`
          : sql``
      }
    `;
    const total = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from organization where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const rows = await this.db.execute(sql`
      select id, name, subdomain, custom_domain, owner_email, preset_id, preset_name,
             status, created_at
        from organization
       where ${where}
       order by created_at ${direction}
       limit ${query.perPage}
      offset ${offset}
    `);
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items: (rows.rows as unknown as StudioRow[]).map(toListItem),
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

  async create(input: StudioInput) {
    assertReserved(input.subdomain);
    if (!input.presetId) throw selectPreset();
    const source = await this.presetById(input.presetId);
    if (!source) throw selectPreset();
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(organization)
          .values({
            ...toValues(input),
            presetId: source.id,
            presetName: source.name,
            scheduleConfig: source.schedule_config,
            billingConfig: source.billing_config,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('organization was not created');
        const sections = orderSections(source.sections);
        for (const section of sections) {
          await tx
            .insert(organizationSection)
            .values({ organizationId: row.id, section });
        }
        const types = source.catalog_config.resourceTypes;
        for (let index = 0; index < types.length; index += 1) {
          const type = types[index]!;
          await tx.insert(organizationResourceType).values({
            organizationId: row.id,
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
        return toOrganization(row, sections);
      });
    } catch (error) {
      const taken = await this.takenError(error, input);
      if (taken) throw taken;
      throw error;
    }
  }

  async get(id: string) {
    const rows = await this.db.execute(
      sql`select * from organization where id = ${id}`,
    );
    const row = rows.rows[0] as FullRow | undefined;
    if (!row) throw ApiError.notFound('Organization not found');
    return toOrganization(fromRow(row), await this.sectionsOf(id));
  }

  async update(id: string, patch: Partial<StudioInput>) {
    const current = await this.get(id);
    const next: StudioInput = {
      name: patch.name ?? current.name,
      subdomain: patch.subdomain ?? current.subdomain,
      customDomain:
        patch.customDomain === undefined
          ? current.customDomain
          : patch.customDomain,
      ownerEmail: patch.ownerEmail ?? current.owner.email,
    };
    if (patch.subdomain) assertReserved(patch.subdomain);
    const previousOwner = current.owner.email;
    const ownerChanged = next.ownerEmail !== previousOwner;
    try {
      return await this.db.transaction(async (tx) => {
        if (ownerChanged) await assertOwnerIsNotStaff(tx, id, next.ownerEmail);
        const updated = await tx
          .update(organization)
          .set({ ...toValues(next), updatedAt: new Date() })
          .where(sql`${organization.id} = ${id}`)
          .returning();
        const row = updated[0];
        if (!row) throw ApiError.notFound('Organization not found');
        if (patch.sections) {
          await tx
            .delete(organizationSection)
            .where(eq(organizationSection.organizationId, id));
          for (const section of patch.sections) {
            await tx
              .insert(organizationSection)
              .values({ organizationId: id, section });
          }
        }
        if (ownerChanged) {
          await tx.execute(sql`
            update organization_session
               set revoked_at = now()
             where organization_id = ${id}
               and email = ${previousOwner}
               and revoked_at is null
          `);
        }
        const sections = patch.sections ?? (await this.sectionsOf(id));
        return toOrganization(row, sections);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const taken = await this.takenError(error, next, id);
      if (taken) throw taken;
      throw error;
    }
  }

  /** Sets the status. A repeat call changes nothing and returns the organization. */
  async setStatus(id: string, status: 'active' | 'deactivated') {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(organization)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(organization.id, id), ne(organization.status, status)))
        .returning();
      const row = updated[0];
      if (!row) return this.get(id);
      if (status === 'deactivated') {
        await tx.execute(sql`
          update organization_session
             set revoked_at = now()
           where organization_id = ${id}
             and revoked_at is null
             and impersonated_by is null
        `);
      }
      return toOrganization(row, await this.sectionsOf(id));
    });
  }

  /** Issues a one-time handoff code for the studio, in any status. */
  async impersonate(id: string, administratorId: string) {
    await this.get(id);
    const code = newHandoffCode();
    await this.db.insert(handoffCode).values({
      codeHash: sha256(code),
      organizationId: id,
      platformAdministratorId: administratorId,
      expiresAt: new Date(Date.now() + HANDOFF_CODE_TTL_SECONDS * 1000),
    });
    return { code, expiresIn: HANDOFF_CODE_TTL_SECONDS };
  }

  private async takenError(
    error: unknown,
    input: StudioInput,
    exceptId?: string,
  ) {
    const constraint = uniqueViolation(error);
    if (!constraint) return undefined;
    if (
      constraint === 'organization_subdomain_unique' ||
      (await this.subdomainTaken(input.subdomain, exceptId))
    ) {
      return taken(
        'SUBDOMAIN_TAKEN',
        'subdomain',
        'This subdomain is already taken',
      );
    }
    if (constraint === 'organization_custom_domain_unique') {
      return taken(
        'DOMAIN_TAKEN',
        'customDomain',
        'This domain is already used by another organization',
      );
    }
    return undefined;
  }

  private async subdomainTaken(subdomain: string, exceptId?: string) {
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from organization
       where subdomain = ${subdomain}
         ${exceptId ? sql`and id <> ${exceptId}` : sql``}
       limit 1
    `);
    return rows.rows.length > 0;
  }

  private async presetById(id: string) {
    const rows = await this.db.execute(sql`
      select id, name, sections, catalog_config, schedule_config, billing_config
        from preset
       where id = ${id}
    `);
    return rows.rows[0] as PresetStamp | undefined;
  }

  private async sectionsOf(id: string) {
    const rows = await this.db
      .select({ section: organizationSection.section })
      .from(organizationSection)
      .where(eq(organizationSection.organizationId, id));
    return orderSections(rows.map((row) => row.section));
  }
}

async function assertOwnerIsNotStaff(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  organizationId: string,
  email: string,
) {
  const staff = await tx.execute(sql`
    select 1 from organization_staff
     where organization_id = ${organizationId} and email = ${email}
     limit 1
  `);
  if (staff.rows.length > 0) {
    throw new ApiError({
      statusCode: 409,
      code: 'OWNER_IS_STAFF',
      message: 'This e-mail is already a staff member of this organization',
      field: 'owner.email',
    });
  }
}

function selectPreset() {
  return ApiError.validation([
    {
      code: 'INVALID_VALUE',
      field: 'presetId',
      message: 'Select a preset',
    },
  ]);
}

function assertReserved(subdomain: string) {
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(subdomain)) {
    throw new ApiError({
      statusCode: 409,
      code: 'SUBDOMAIN_RESERVED',
      message: 'This subdomain is reserved',
      field: 'subdomain',
    });
  }
}

function taken(code: string, field: string, message: string) {
  return new ApiError({ statusCode: 409, code, message, field });
}

function toValues(input: StudioInput) {
  return {
    name: input.name,
    subdomain: input.subdomain,
    customDomain: input.customDomain ?? null,
    ownerEmail: input.ownerEmail,
  };
}

function toOrganization(
  row: {
    id: string;
    name: string;
    subdomain: string;
    customDomain: string | null;
    ownerEmail: string;
    presetId: string | null;
    presetName: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  sections: string[],
) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    customDomain: row.customDomain,
    owner: { email: row.ownerEmail },
    preset: { id: row.presetId, name: row.presetName },
    sections: orderSections(sections),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toListItem(row: StudioRow) {
  return {
    id: row.id,
    name: row.name,
    preset: { id: row.preset_id, name: row.preset_name },
    subdomain: row.subdomain,
    customDomain: row.custom_domain,
    owner: { email: row.owner_email },
    status: row.status,
    createdAt: row.created_at,
  };
}

function fromRow(row: FullRow) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    customDomain: row.custom_domain,
    ownerEmail: row.owner_email,
    presetId: row.preset_id,
    presetName: row.preset_name,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

interface StudioRow {
  id: string;
  name: string;
  subdomain: string;
  custom_domain: string | null;
  owner_email: string;
  preset_id: string | null;
  preset_name: string;
  status: string;
  created_at: Date;
}

interface PresetStamp {
  id: string;
  name: string;
  sections: string[];
  catalog_config: { resourceTypes: ResourceTypeFields[] };
  schedule_config: unknown;
  billing_config: unknown;
}

interface FullRow extends StudioRow {
  updated_at: Date;
}

function uniqueViolation(error: unknown): string | undefined {
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
