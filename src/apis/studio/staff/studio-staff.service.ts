import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  studio,
  studioSession,
  studioStaff,
} from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
}

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
      studio_id = ${session.studioId}
      ${pattern ? sql`and email ilike ${pattern} escape '\\'` : sql``}
    `;
    const total = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from studio_staff where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'email' ? sql`email` : sql`created_at`;
    const direction = query.order === 'ASC' ? sql`asc` : sql`desc`;
    const rows = await this.db.execute(sql`
      select id, email, role, created_at
        from studio_staff
       where ${where}
       order by ${column} ${direction}, id
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
    return this.read(session.studioId, id);
  }

  async add(
    session: StudioSessionInfo,
    input: { email: string; role: string },
  ): Promise<StaffMember> {
    await this.access.assertSection(session, 'staff');
    await this.assertCanAdd(session.studioId, input.email);
    try {
      const inserted = await this.db
        .insert(studioStaff)
        .values({
          studioId: session.studioId,
          email: input.email,
          role: input.role,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('staff member was not created');
      return {
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt,
      };
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyAdded();
      throw error;
    }
  }

  async changeRole(
    session: StudioSessionInfo,
    id: string,
    role: string,
  ): Promise<StaffMember> {
    await this.access.assertSection(session, 'staff');
    const updated = await this.db
      .update(studioStaff)
      .set({ role })
      .where(
        and(eq(studioStaff.id, id), eq(studioStaff.studioId, session.studioId)),
      )
      .returning();
    const row = updated[0];
    if (!row) throw ApiError.notFound('Staff member not found');
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt,
    };
  }

  async remove(session: StudioSessionInfo, id: string) {
    await this.access.assertSection(session, 'staff');
    const existing = await this.read(session.studioId, id);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(studioStaff)
        .where(
          and(
            eq(studioStaff.id, id),
            eq(studioStaff.studioId, session.studioId),
          ),
        );
      await tx
        .update(studioSession)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(studioSession.studioId, session.studioId),
            eq(studioSession.email, existing.email),
            isNull(studioSession.revokedAt),
          ),
        );
    });
  }

  private async assertCanAdd(studioId: string, email: string) {
    const staff = await this.db
      .select({ id: studioStaff.id })
      .from(studioStaff)
      .where(
        and(eq(studioStaff.studioId, studioId), eq(studioStaff.email, email)),
      );
    if (staff.length > 0) throw alreadyAdded();
    const owners = await this.db
      .select({ ownerEmail: studio.ownerEmail })
      .from(studio)
      .where(eq(studio.id, studioId));
    if (owners[0]?.ownerEmail === email) throw emailIsOwner();
  }

  private async read(studioId: string, id: string): Promise<StaffMember> {
    const rows = await this.db
      .select({
        id: studioStaff.id,
        email: studioStaff.email,
        role: studioStaff.role,
        createdAt: studioStaff.createdAt,
      })
      .from(studioStaff)
      .where(and(eq(studioStaff.id, id), eq(studioStaff.studioId, studioId)));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Staff member not found');
    return row;
  }
}

interface StaffRow {
  id: string;
  email: string;
  role: string;
  created_at: Date | string;
}

function toMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: new Date(row.created_at),
  };
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
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

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
