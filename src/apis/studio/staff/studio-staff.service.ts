import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  staffTrainer,
  studio,
  studioSession,
  studioStaff,
  trainer,
} from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  trainerId: string | null;
  createdAt: Date;
}

type StaffInput = {
  role?: string;
  trainerId?: string | null;
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
      s.studio_id = ${session.studioId}
      ${pattern ? sql`and s.email ilike ${pattern} escape '\\'` : sql``}
    `;
    const total = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from studio_staff s where ${where}`,
    );
    const totalItems = total.rows[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'email' ? sql`s.email` : sql`s.created_at`;
    const direction = query.order === 'ASC' ? sql`asc` : sql`desc`;
    const rows = await this.db.execute(sql`
      select s.id, s.email, s.role, s.created_at, l.trainer_id
        from studio_staff s
        left join staff_trainer l on l.staff_id = s.id
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
    return this.read(session.studioId, id);
  }

  async add(
    session: StudioSessionInfo,
    input: { email: string; role: string; trainerId?: string | null },
  ): Promise<StaffMember> {
    await this.access.assertSection(session, 'staff');
    const trainerId =
      input.role === 'trainer' ? (input.trainerId ?? null) : null;
    if (input.role === 'trainer' && !trainerId) throw selectTrainer();
    if (trainerId) {
      await this.assertTrainerOfStudio(session.studioId, trainerId);
    }
    await this.assertCanAdd(session.studioId, input.email);
    if (trainerId) await this.assertTrainerFree(trainerId, null);
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(studioStaff)
          .values({
            studioId: session.studioId,
            email: input.email,
            role: input.role,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('staff member was not created');
        if (trainerId) {
          await tx.insert(staffTrainer).values({
            studioId: session.studioId,
            staffId: row.id,
            trainerId,
          });
        }
        return {
          id: row.id,
          email: row.email,
          role: row.role,
          trainerId,
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
    const current = await this.read(session.studioId, id);
    const role = input.role ?? current.role;
    if (role !== 'trainer' && input.trainerId) throw trainerNotForRole();
    if (role === 'trainer' && input.trainerId === null) throw selectTrainer();
    if (role === 'trainer' && current.role !== 'trainer' && !input.trainerId) {
      throw selectTrainer();
    }
    const nextTrainerId =
      role === 'trainer'
        ? input.trainerId === undefined
          ? current.trainerId
          : input.trainerId
        : null;
    if (role === 'trainer' && !nextTrainerId) throw selectTrainer();
    if (nextTrainerId) {
      await this.assertTrainerOfStudio(session.studioId, nextTrainerId);
      await this.assertTrainerFree(nextTrainerId, current.id);
    }
    try {
      await this.db.transaction(async (tx) => {
        if (role !== current.role) {
          await tx
            .update(studioStaff)
            .set({ role })
            .where(
              and(
                eq(studioStaff.id, id),
                eq(studioStaff.studioId, session.studioId),
              ),
            );
        }
        if (!nextTrainerId) {
          await tx.delete(staffTrainer).where(eq(staffTrainer.staffId, id));
          return;
        }
        if (current.trainerId === null) {
          await tx.insert(staffTrainer).values({
            studioId: session.studioId,
            staffId: id,
            trainerId: nextTrainerId,
          });
          return;
        }
        if (current.trainerId !== nextTrainerId) {
          await tx
            .update(staffTrainer)
            .set({ trainerId: nextTrainerId })
            .where(eq(staffTrainer.staffId, id));
        }
      });
    } catch (error) {
      throw mapUnique(error);
    }
    return this.read(session.studioId, id);
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

  private async assertTrainerOfStudio(studioId: string, trainerId: string) {
    const rows = await this.db
      .select({ id: trainer.id })
      .from(trainer)
      .where(and(eq(trainer.id, trainerId), eq(trainer.studioId, studioId)));
    if (rows.length !== 1) {
      throw ApiError.validation([
        {
          code: 'INVALID_VALUE',
          field: 'trainerId',
          message: 'Choose a trainer of this studio',
        },
      ]);
    }
  }

  private async assertTrainerFree(
    trainerId: string,
    exceptStaffId: string | null,
  ) {
    const rows = await this.db
      .select({ staffId: staffTrainer.staffId })
      .from(staffTrainer)
      .where(
        exceptStaffId
          ? and(
              eq(staffTrainer.trainerId, trainerId),
              ne(staffTrainer.staffId, exceptStaffId),
            )
          : eq(staffTrainer.trainerId, trainerId),
      );
    if (rows.length > 0) throw trainerAlreadyLinked();
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
        trainerId: staffTrainer.trainerId,
        createdAt: studioStaff.createdAt,
      })
      .from(studioStaff)
      .leftJoin(staffTrainer, eq(staffTrainer.staffId, studioStaff.id))
      .where(and(eq(studioStaff.id, id), eq(studioStaff.studioId, studioId)));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Staff member not found');
    return { ...row, trainerId: row.trainerId ?? null };
  }
}

interface StaffRow {
  id: string;
  email: string;
  role: string;
  trainer_id: string | null;
  created_at: Date | string;
}

function toMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    trainerId: row.trainer_id,
    createdAt: new Date(row.created_at),
  };
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function selectTrainer() {
  return ApiError.validation([
    {
      code: 'REQUIRED',
      field: 'trainerId',
      message: 'Select a trainer',
    },
  ]);
}

function trainerNotForRole() {
  return ApiError.validation([
    {
      code: 'INVALID_VALUE',
      field: 'trainerId',
      message: 'A trainer is only linked to the trainer role',
    },
  ]);
}

function trainerAlreadyLinked() {
  return new ApiError({
    statusCode: 409,
    code: 'TRAINER_ALREADY_LINKED',
    message: 'This trainer is already linked to another staff member',
    field: 'trainerId',
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
  if (constraint === 'staff_trainer_trainer_id_unique') {
    throw trainerAlreadyLinked();
  }
  if (constraint === 'studio_staff_studio_email_unique') throw alreadyAdded();
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
