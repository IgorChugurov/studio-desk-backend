import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import {
  type Database,
  PLATFORM_DB,
} from '../../../database/database.module.js';
import { handoffCode, studio } from '../../../database/schema/index.js';
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
      sql`select count(*)::int as total from studio where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const rows = await this.db.execute(sql`
      select id, name, subdomain, custom_domain, owner_email, status, created_at
        from studio
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
    try {
      const inserted = await this.db
        .insert(studio)
        .values(toValues(input))
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('studio was not created');
      return toStudio(row);
    } catch (error) {
      const taken = await this.takenError(error, input);
      if (taken) throw taken;
      throw error;
    }
  }

  async get(id: string) {
    const rows = await this.db.execute(
      sql`select * from studio where id = ${id}`,
    );
    const row = rows.rows[0] as FullRow | undefined;
    if (!row) throw ApiError.notFound('Studio not found');
    return toStudio(fromRow(row));
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
          .update(studio)
          .set({ ...toValues(next), updatedAt: new Date() })
          .where(sql`${studio.id} = ${id}`)
          .returning();
        const row = updated[0];
        if (!row) throw ApiError.notFound('Studio not found');
        if (ownerChanged) {
          await tx.execute(sql`
            update studio_session
               set revoked_at = now()
             where studio_id = ${id}
               and email = ${previousOwner}
               and revoked_at is null
          `);
        }
        return toStudio(row);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const taken = await this.takenError(error, next, id);
      if (taken) throw taken;
      throw error;
    }
  }

  /** Sets the status. A repeat call changes nothing and returns the studio. */
  async setStatus(id: string, status: 'active' | 'deactivated') {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(studio)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(studio.id, id), ne(studio.status, status)))
        .returning();
      const row = updated[0];
      if (!row) return this.get(id);
      if (status === 'deactivated') {
        await tx.execute(sql`
          update studio_session
             set revoked_at = now()
           where studio_id = ${id}
             and revoked_at is null
             and impersonated_by is null
        `);
      }
      return toStudio(row);
    });
  }

  /** Issues a one-time handoff code for the studio, in any status. */
  async impersonate(id: string, administratorId: string) {
    await this.get(id);
    const code = newHandoffCode();
    await this.db.insert(handoffCode).values({
      codeHash: sha256(code),
      studioId: id,
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
      constraint === 'studio_subdomain_unique' ||
      (await this.subdomainTaken(input.subdomain, exceptId))
    ) {
      return taken(
        'SUBDOMAIN_TAKEN',
        'subdomain',
        'This subdomain is already taken',
      );
    }
    if (constraint === 'studio_custom_domain_unique') {
      return taken(
        'DOMAIN_TAKEN',
        'customDomain',
        'This domain is already used by another studio',
      );
    }
    return undefined;
  }

  private async subdomainTaken(subdomain: string, exceptId?: string) {
    const rows = await this.db.execute<{ id: string }>(sql`
      select id from studio
       where subdomain = ${subdomain}
         ${exceptId ? sql`and id <> ${exceptId}` : sql``}
       limit 1
    `);
    return rows.rows.length > 0;
  }
}

async function assertOwnerIsNotStaff(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  studioId: string,
  email: string,
) {
  const staff = await tx.execute(sql`
    select 1 from studio_staff
     where studio_id = ${studioId} and email = ${email}
     limit 1
  `);
  if (staff.rows.length > 0) {
    throw new ApiError({
      statusCode: 409,
      code: 'OWNER_IS_STAFF',
      message: 'This e-mail is already a staff member of this studio',
      field: 'owner.email',
    });
  }
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

function toStudio(row: {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  ownerEmail: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    customDomain: row.customDomain,
    owner: { email: row.ownerEmail },
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toListItem(row: StudioRow) {
  return {
    id: row.id,
    name: row.name,
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
  status: string;
  created_at: Date;
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
