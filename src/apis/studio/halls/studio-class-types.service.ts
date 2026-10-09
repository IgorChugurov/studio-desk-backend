import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { rm } from 'node:fs/promises';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { classType, classTypeFile } from '../../../database/schema/catalog.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { diskPathOfAddress } from './storage-path.js';
import {
  acceptedFiles,
  deleteUploads,
  placeFiles,
} from './studio-trainers.service.js';

export interface ClassTypeView {
  id: string;
  name: string;
  description: string | null;
  images: {
    id: string;
    index: number;
    kind: 'image' | 'video';
    contentType: string;
    url: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class StudioClassTypesService {
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
      sortBy: 'createdAt' | 'name';
      order: 'ASC' | 'DESC';
    },
  ) {
    await this.access.assertSection(session, 'catalogs');
    const pattern = query.search ? likePattern(query.search) : undefined;
    const where = pattern
      ? and(
          eq(classType.studioId, session.studioId),
          sql`${classType.name} ilike ${pattern} escape '\\'`,
        )
      : eq(classType.studioId, session.studioId);
    const totals = await this.db
      .select({ total: count() })
      .from(classType)
      .where(where);
    const totalItems = totals[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column =
      query.sortBy === 'name' ? classType.name : classType.createdAt;
    const direction = query.order === 'ASC' ? asc(column) : desc(column);
    const rows = await this.db
      .select()
      .from(classType)
      .where(where)
      .orderBy(direction, asc(classType.id))
      .limit(query.perPage)
      .offset(offset);
    const images = await this.imagesOf(rows.map((row) => row.id));
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items: rows.map((row) => toClassType(row, images.get(row.id) ?? [])),
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

  async get(session: StudioSessionInfo, id: string): Promise<ClassTypeView> {
    await this.access.assertSection(session, 'catalogs');
    return this.read(session.studioId, id);
  }

  async create(
    session: StudioSessionInfo,
    input: { name: string; description: string | null },
  ): Promise<ClassTypeView> {
    await this.access.assertSection(session, 'catalogs');
    const inserted = await this.db
      .insert(classType)
      .values({
        studioId: session.studioId,
        name: input.name,
        description: input.description,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('class type was not created');
    return toClassType(row, []);
  }

  async update(
    session: StudioSessionInfo,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<ClassTypeView> {
    await this.access.assertSection(session, 'catalogs');
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
    };
    if (Object.keys(changes).length > 0) {
      const updated = await this.db
        .update(classType)
        .set({ ...changes, updatedAt: new Date() })
        .where(
          and(eq(classType.id, id), eq(classType.studioId, session.studioId)),
        )
        .returning({ id: classType.id });
      if (!updated[0]) throw ApiError.notFound('Class type not found');
    }
    return this.read(session.studioId, id);
  }

  async upload(
    session: StudioSessionInfo,
    classTypeId: string,
    request: Request,
  ): Promise<ClassTypeView> {
    await this.access.assertSection(session, 'catalogs');
    const accepted = await acceptedFiles(request);
    const placed = await placeFiles('class-types', classTypeId, accepted);
    try {
      await this.db.transaction(async (tx) => {
        const locked = await tx
          .select({ id: classType.id })
          .from(classType)
          .where(
            and(
              eq(classType.id, classTypeId),
              eq(classType.studioId, session.studioId),
            ),
          )
          .for('update');
        if (!locked[0]) throw ApiError.notFound('Class type not found');
        const existing = await tx
          .select({ id: classTypeFile.id })
          .from(classTypeFile)
          .where(eq(classTypeFile.classTypeId, classTypeId));
        let index = existing.length;
        for (const file of placed) {
          await tx.insert(classTypeFile).values({
            id: file.id,
            classTypeId,
            storagePath: file.address,
            contentType: file.contentType,
            index,
          });
          index += 1;
        }
      });
    } catch (error) {
      await deleteUploads(
        placed.map((file) => diskPathOfAddress(file.address)),
      );
      throw error;
    }
    return this.read(session.studioId, classTypeId);
  }

  async removeFile(
    session: StudioSessionInfo,
    classTypeId: string,
    fileId: string,
  ): Promise<ClassTypeView> {
    await this.access.assertSection(session, 'catalogs');
    const storagePath = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: classType.id })
        .from(classType)
        .where(
          and(
            eq(classType.id, classTypeId),
            eq(classType.studioId, session.studioId),
          ),
        )
        .for('update');
      if (!locked[0]) throw ApiError.notFound('Class type not found');
      const rows = await tx
        .select({
          id: classTypeFile.id,
          storagePath: classTypeFile.storagePath,
        })
        .from(classTypeFile)
        .where(eq(classTypeFile.classTypeId, classTypeId))
        .orderBy(asc(classTypeFile.index));
      const target = rows.find((row) => row.id === fileId);
      if (!target) throw ApiError.notFound('File not found');
      await tx.delete(classTypeFile).where(eq(classTypeFile.id, fileId));
      const remaining = rows
        .filter((row) => row.id !== fileId)
        .map((row) => row.id);
      const shift = 1_000_000;
      for (let index = 0; index < remaining.length; index++) {
        const id = remaining[index];
        if (!id) continue;
        await tx
          .update(classTypeFile)
          .set({ index: shift + index })
          .where(eq(classTypeFile.id, id));
      }
      for (let index = 0; index < remaining.length; index++) {
        const id = remaining[index];
        if (!id) continue;
        await tx
          .update(classTypeFile)
          .set({ index })
          .where(eq(classTypeFile.id, id));
      }
      return target.storagePath;
    });
    await rm(diskPathOfAddress(storagePath), { force: true });
    return this.read(session.studioId, classTypeId);
  }

  async reorder(
    session: StudioSessionInfo,
    classTypeId: string,
    fileIds: string[],
  ): Promise<ClassTypeView> {
    await this.access.assertSection(session, 'catalogs');
    await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: classType.id })
        .from(classType)
        .where(
          and(
            eq(classType.id, classTypeId),
            eq(classType.studioId, session.studioId),
          ),
        )
        .for('update');
      if (!locked[0]) throw ApiError.notFound('Class type not found');
      const rows = await tx
        .select({ id: classTypeFile.id })
        .from(classTypeFile)
        .where(eq(classTypeFile.classTypeId, classTypeId));
      const current = new Set(rows.map((row) => row.id));
      const sent = new Set(fileIds);
      if (
        current.size !== fileIds.length ||
        sent.size !== fileIds.length ||
        !fileIds.every((id) => current.has(id))
      ) {
        throw ApiError.validation([
          {
            code: FieldErrorCode.INVALID,
            field: 'fileIds',
            message:
              'Send every file of this class type once, in the new order',
          },
        ]);
      }
      const shift = 1_000_000;
      for (let index = 0; index < fileIds.length; index++) {
        const id = fileIds[index];
        if (!id) continue;
        await tx
          .update(classTypeFile)
          .set({ index: shift + index })
          .where(eq(classTypeFile.id, id));
      }
      for (let index = 0; index < fileIds.length; index++) {
        const id = fileIds[index];
        if (!id) continue;
        await tx
          .update(classTypeFile)
          .set({ index })
          .where(eq(classTypeFile.id, id));
      }
    });
    return this.read(session.studioId, classTypeId);
  }

  private async read(studioId: string, id: string): Promise<ClassTypeView> {
    const rows = await this.db
      .select()
      .from(classType)
      .where(and(eq(classType.id, id), eq(classType.studioId, studioId)));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Class type not found');
    const images = await this.imagesOf([row.id]);
    return toClassType(row, images.get(row.id) ?? []);
  }

  private async imagesOf(ids: string[]) {
    const grouped = new Map<string, ClassTypeView['images']>();
    if (ids.length === 0) return grouped;
    const rows = await this.db
      .select({
        id: classTypeFile.id,
        classTypeId: classTypeFile.classTypeId,
        index: classTypeFile.index,
        contentType: classTypeFile.contentType,
        storagePath: classTypeFile.storagePath,
      })
      .from(classTypeFile)
      .where(inArray(classTypeFile.classTypeId, ids))
      .orderBy(asc(classTypeFile.index));
    for (const row of rows) {
      const list = grouped.get(row.classTypeId) ?? [];
      list.push({
        id: row.id,
        index: row.index,
        kind: row.contentType.startsWith('video/') ? 'video' : 'image',
        contentType: row.contentType,
        url: row.storagePath,
      });
      grouped.set(row.classTypeId, list);
    }
    return grouped;
  }
}

function toClassType(
  row: typeof classType.$inferSelect,
  images: ClassTypeView['images'],
): ClassTypeView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    images,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
