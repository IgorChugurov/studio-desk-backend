import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  organization,
  organizationResourceType,
  organizationSession,
  organizationStaff,
  resource,
  staffResource,
} from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  resourceId: string | null;
  createdAt: Date;
}

type StaffInput = {
  role?: string;
  resourceId?: string | null;
};

@Injectable()
export class StudioStaffService {
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
      sortBy: 'createdAt' | 'email';
      order: 'ASC' | 'DESC';
    },
  ) {
    await this.access.assertSection(session, 'staff');
    const pattern = query.search ? likePattern(query.search) : undefined;
    const where = sql`
      s.organization_id = ${session.organizationId}
      ${pattern ? sql`and s.email ilike ${pattern} escape '\\'` : sql``}
    `;
    const total = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from organization_staff s where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'email' ? sql`s.email` : sql`s.created_at`;
    const direction = query.order === 'ASC' ? sql`asc` : sql`desc`;
    const rows = await this.db.execute(sql`
      select s.id, s.email, s.role, s.created_at, l.resource_id
        from organization_staff s
        left join staff_resource l on l.staff_id = s.id
       where ${where}
       order by ${column} ${direction}, s.id
       limit ${query.perPage}
      offset ${offset}
    `);
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items: (rows.rows as unknown as StaffRow[]).map(toMember),
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

  async get(session: StudioSessionInfo, id: string): Promise<StaffMember> {
    await this.access.assertSection(session, 'staff');
    return this.read(session.organizationId, id);
  }

  async add(
    session: StudioSessionInfo,
    input: { email: string; role: string; resourceId?: string | null },
  ): Promise<StaffMember> {
    await this.access.assertSection(session, 'staff');
    const resourceId =
      input.role === 'specialist' ? (input.resourceId ?? null) : null;
    if (input.role === 'specialist' && !resourceId) throw selectSpecialist();
    if (resourceId) {
      await this.assertResourceOfOrganization(
        session.organizationId,
        resourceId,
      );
    }
    await this.assertCanAdd(session.organizationId, input.email);
    if (resourceId) await this.assertResourceFree(resourceId, null);
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(organizationStaff)
          .values({
            organizationId: session.organizationId,
            email: input.email,
            role: input.role,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('staff member was not created');
        if (resourceId) {
          await tx.insert(staffResource).values({
            organizationId: session.organizationId,
            staffId: row.id,
            resourceId,
          });
        }
        return {
          id: row.id,
          email: row.email,
          role: row.role,
          resourceId,
          createdAt: row.createdAt,
        };
      });
    } catch (error) {
      throw mapUnique(error);
    }
  }

  async update(
    session: StudioSessionInfo,
    id: string,
    input: StaffInput,
  ): Promise<StaffMember> {
    await this.access.assertSection(session, 'staff');
    const current = await this.read(session.organizationId, id);
    const role = input.role ?? current.role;
    if (role !== 'specialist' && input.resourceId) throw resourceNotForRole();
    if (role === 'specialist' && input.resourceId === null)
      throw selectSpecialist();
    if (
      role === 'specialist' &&
      current.role !== 'specialist' &&
      !input.resourceId
    ) {
      throw selectSpecialist();
    }
    const nextResourceId =
      role === 'specialist'
        ? input.resourceId === undefined
          ? current.resourceId
          : input.resourceId
        : null;
    if (role === 'specialist' && !nextResourceId) throw selectSpecialist();
    if (nextResourceId) {
      await this.assertResourceOfOrganization(
        session.organizationId,
        nextResourceId,
      );
      await this.assertResourceFree(nextResourceId, current.id);
    }
    try {
      await this.db.transaction(async (tx) => {
        if (role !== current.role) {
          await tx
            .update(organizationStaff)
            .set({ role })
            .where(
              and(
                eq(organizationStaff.id, id),
                eq(organizationStaff.organizationId, session.organizationId),
              ),
            );
        }
        if (!nextResourceId) {
          await tx.delete(staffResource).where(eq(staffResource.staffId, id));
          return;
        }
        if (current.resourceId === null) {
          await tx.insert(staffResource).values({
            organizationId: session.organizationId,
            staffId: id,
            resourceId: nextResourceId,
          });
          return;
        }
        if (current.resourceId !== nextResourceId) {
          await tx
            .update(staffResource)
            .set({ resourceId: nextResourceId })
            .where(eq(staffResource.staffId, id));
        }
      });
    } catch (error) {
      throw mapUnique(error);
    }
    return this.read(session.organizationId, id);
  }

  async remove(session: StudioSessionInfo, id: string) {
    await this.access.assertSection(session, 'staff');
    const existing = await this.read(session.organizationId, id);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(organizationStaff)
        .where(
          and(
            eq(organizationStaff.id, id),
            eq(organizationStaff.organizationId, session.organizationId),
          ),
        );
      await tx
        .update(organizationSession)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationSession.organizationId, session.organizationId),
            eq(organizationSession.email, existing.email),
            isNull(organizationSession.revokedAt),
          ),
        );
    });
  }

  private async assertResourceOfOrganization(
    organizationId: string,
    resourceId: string,
  ) {
    const rows = await this.db
      .select({ id: resource.id })
      .from(resource)
      .innerJoin(
        organizationResourceType,
        eq(organizationResourceType.id, resource.resourceTypeId),
      )
      .where(
        and(
          eq(resource.id, resourceId),
          eq(resource.organizationId, organizationId),
          eq(organizationResourceType.person, true),
        ),
      );
    if (rows.length !== 1) {
      throw ApiError.validation([
        {
          code: 'INVALID_VALUE',
          field: 'resourceId',
          message: 'Choose a specialist of this organization',
        },
      ]);
    }
  }

  private async assertResourceFree(
    resourceId: string,
    exceptStaffId: string | null,
  ) {
    const rows = await this.db
      .select({ staffId: staffResource.staffId })
      .from(staffResource)
      .where(
        exceptStaffId
          ? and(
              eq(staffResource.resourceId, resourceId),
              ne(staffResource.staffId, exceptStaffId),
            )
          : eq(staffResource.resourceId, resourceId),
      );
    if (rows.length > 0) throw specialistAlreadyLinked();
  }

  private async assertCanAdd(organizationId: string, email: string) {
    const staff = await this.db
      .select({ id: organizationStaff.id })
      .from(organizationStaff)
      .where(
        and(
          eq(organizationStaff.organizationId, organizationId),
          eq(organizationStaff.email, email),
        ),
      );
    if (staff.length > 0) throw alreadyAdded();
    const owners = await this.db
      .select({ ownerEmail: organization.ownerEmail })
      .from(organization)
      .where(eq(organization.id, organizationId));
    if (owners[0]?.ownerEmail === email) throw emailIsOwner();
  }

  private async read(organizationId: string, id: string): Promise<StaffMember> {
    const rows = await this.db
      .select({
        id: organizationStaff.id,
        email: organizationStaff.email,
        role: organizationStaff.role,
        resourceId: staffResource.resourceId,
        createdAt: organizationStaff.createdAt,
      })
      .from(organizationStaff)
      .leftJoin(staffResource, eq(staffResource.staffId, organizationStaff.id))
      .where(
        and(
          eq(organizationStaff.id, id),
          eq(organizationStaff.organizationId, organizationId),
        ),
      );
    const row = rows[0];
    if (!row) throw ApiError.notFound('Staff member not found');
    return { ...row, resourceId: row.resourceId ?? null };
  }
}

interface StaffRow {
  id: string;
  email: string;
  role: string;
  resource_id: string | null;
  created_at: Date | string;
}

function toMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    resourceId: row.resource_id,
    createdAt: new Date(row.created_at),
  };
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function selectSpecialist() {
  return ApiError.validation([
    {
      code: 'REQUIRED',
      field: 'resourceId',
      message: 'Select a specialist',
    },
  ]);
}

function resourceNotForRole() {
  return ApiError.validation([
    {
      code: 'INVALID_VALUE',
      field: 'resourceId',
      message: 'A specialist is only linked to the specialist role',
    },
  ]);
}

function specialistAlreadyLinked() {
  return new ApiError({
    statusCode: 409,
    code: 'SPECIALIST_ALREADY_LINKED',
    message: 'This specialist is already linked to another staff member',
    field: 'resourceId',
  });
}

function alreadyAdded() {
  return new ApiError({
    statusCode: 409,
    code: 'STAFF_ALREADY_ADDED',
    message: 'This e-mail is already added to the studio',
    field: 'email',
  });
}

function emailIsOwner() {
  return new ApiError({
    statusCode: 409,
    code: 'EMAIL_IS_OWNER',
    message: 'This e-mail belongs to the studio owner',
    field: 'email',
  });
}

function mapUnique(error: unknown): never {
  const constraint = uniqueConstraint(error);
  if (constraint === 'staff_resource_resource_id_unique') {
    throw specialistAlreadyLinked();
  }
  if (constraint === 'organization_staff_studio_email_unique')
    throw alreadyAdded();
  throw error;
}

function uniqueConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23505') {
      if ('constraint' in current && typeof current.constraint === 'string') {
        return current.constraint;
      }
      return undefined;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
