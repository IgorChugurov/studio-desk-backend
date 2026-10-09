import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { hall, hallFile } from '../../../database/schema/hall.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { detectContentType, fileRejection } from './file-type.js';
import { readUploadedFiles } from './multipart-files.js';
import {
  diskPathOfAddress,
  fileAddress,
  readFileHeader,
} from './storage-path.js';

export interface HallFileView {
  id: string;
  index: number;
  kind: 'image' | 'video';
  contentType: string;
  url: string;
}

export interface HallView {
  id: string;
  name: string;
  address: string;
  videoLink: string | null;
  images: HallFileView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface HallWrite {
  name?: string;
  address?: string;
  videoLink?: string | null;
}

@Injectable()
export class StudioHallsService {
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
          eq(hall.studioId, session.studioId),
          sql`${hall.name} ilike ${pattern} escape '\\'`,
        )
      : eq(hall.studioId, session.studioId);
    const totals = await this.db
      .select({ total: count() })
      .from(hall)
      .where(where);
    const totalItems = totals[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'name' ? hall.name : hall.createdAt;
    const direction = query.order === 'ASC' ? asc(column) : desc(column);
    const rows = await this.db
      .select()
      .from(hall)
      .where(where)
      .orderBy(direction, asc(hall.id))
      .limit(query.perPage)
      .offset(offset);
    const images = await this.imagesOf(rows.map((row) => row.id));
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items: rows.map((row) => toHall(row, images.get(row.id) ?? [])),
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

  async get(session: StudioSessionInfo, id: string): Promise<HallView> {
    await this.access.assertSection(session, 'catalogs');
    return this.read(session.studioId, id);
  }

  async create(
    session: StudioSessionInfo,
    input: { name: string; address: string; videoLink: string | null },
  ): Promise<HallView> {
    await this.access.assertSection(session, 'catalogs');
    const inserted = await this.db
      .insert(hall)
      .values({
        studioId: session.studioId,
        name: input.name,
        address: input.address,
        videoLink: input.videoLink,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('hall was not created');
    return toHall(row, []);
  }

  async update(
    session: StudioSessionInfo,
    id: string,
    input: HallWrite,
  ): Promise<HallView> {
    await this.access.assertSection(session, 'catalogs');
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.videoLink === undefined ? {} : { videoLink: input.videoLink }),
    };
    if (Object.keys(changes).length > 0) {
      const updated = await this.db
        .update(hall)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(hall.id, id), eq(hall.studioId, session.studioId)))
        .returning({ id: hall.id });
      if (!updated[0]) throw ApiError.notFound('Hall not found');
    }
    return this.read(session.studioId, id);
  }

  async upload(
    session: StudioSessionInfo,
    hallId: string,
    request: Request,
  ): Promise<HallView> {
    await this.access.assertSection(session, 'catalogs');
    const parts = await readUploadedFiles(request);
    const accepted: { path: string; contentType: string }[] = [];
    const errors: { code: string; field: string; message: string }[] = [];
    if (parts.length === 0) {
      errors.push({
        code: FieldErrorCode.REQUIRED,
        field: 'files',
        message: 'Choose a file',
      });
    }
    for (const part of parts) {
      const header = await readFileHeader(part.path);
      const code = fileRejection(part.size, header, part.truncated);
      const contentType = detectContentType(header);
      if (code || !contentType) {
        errors.push({
          code: code ?? FieldErrorCode.INVALID_VALUE,
          field: 'files',
          message: fileMessage(code ?? FieldErrorCode.INVALID_VALUE),
        });
      } else {
        accepted.push({ path: part.path, contentType });
      }
    }
    if (errors.length > 0) {
      await discardTemps(parts.map((part) => part.path));
      throw ApiError.validation(errors);
    }

    const placed: { id: string; address: string; contentType: string }[] = [];
    try {
      for (const part of accepted) {
        const id = randomUUID();
        const address = fileAddress(hallId, id, part.contentType);
        await moveIntoStorage(part.path, diskPathOfAddress(address));
        placed.push({ id, address, contentType: part.contentType });
      }
      await this.db.transaction(async (tx) => {
        const locked = await tx
          .select({ id: hall.id })
          .from(hall)
          .where(and(eq(hall.id, hallId), eq(hall.studioId, session.studioId)))
          .for('update');
        if (!locked[0]) throw ApiError.notFound('Hall not found');
        const existing = await tx
          .select({ id: hallFile.id })
          .from(hallFile)
          .where(eq(hallFile.hallId, hallId));
        let index = existing.length;
        for (const file of placed) {
          await tx.insert(hallFile).values({
            id: file.id,
            hallId,
            storagePath: file.address,
            contentType: file.contentType,
            index,
          });
          index += 1;
        }
      });
    } catch (error) {
      await discardTemps(accepted.map((part) => part.path));
      await deleteUploads(
        placed.map((file) => diskPathOfAddress(file.address)),
      );
      throw error;
    }
    return this.read(session.studioId, hallId);
  }

  async removeFile(
    session: StudioSessionInfo,
    hallId: string,
    fileId: string,
  ): Promise<HallView> {
    await this.access.assertSection(session, 'catalogs');
    const storagePath = await this.db.transaction(async (tx) => {
      await this.lockHall(tx, session.studioId, hallId);
      const rows = await tx
        .select({ id: hallFile.id, storagePath: hallFile.storagePath })
        .from(hallFile)
        .where(eq(hallFile.hallId, hallId))
        .orderBy(asc(hallFile.index));
      const target = rows.find((row) => row.id === fileId);
      if (!target) throw ApiError.notFound('File not found');
      await tx.delete(hallFile).where(eq(hallFile.id, fileId));
      await this.rewriteIndexes(
        tx,
        rows.filter((row) => row.id !== fileId).map((row) => row.id),
      );
      return target.storagePath;
    });
    await rm(diskPathOfAddress(storagePath), { force: true });
    return this.read(session.studioId, hallId);
  }

  async reorder(
    session: StudioSessionInfo,
    hallId: string,
    fileIds: string[],
  ): Promise<HallView> {
    await this.access.assertSection(session, 'catalogs');
    await this.db.transaction(async (tx) => {
      await this.lockHall(tx, session.studioId, hallId);
      const rows = await tx
        .select({ id: hallFile.id })
        .from(hallFile)
        .where(eq(hallFile.hallId, hallId));
      const current = new Set(rows.map((row) => row.id));
      const sent = new Set(fileIds);
      const same =
        current.size === fileIds.length &&
        sent.size === fileIds.length &&
        fileIds.every((id) => current.has(id));
      if (!same) {
        throw ApiError.validation([
          {
            code: FieldErrorCode.INVALID,
            field: 'fileIds',
            message: 'Send every file of this hall once, in the new order',
          },
        ]);
      }
      await this.rewriteIndexes(tx, fileIds);
    });
    return this.read(session.studioId, hallId);
  }

  private async lockHall(
    tx: HallTx,
    studioId: string,
    hallId: string,
  ): Promise<void> {
    const locked = await tx
      .select({ id: hall.id })
      .from(hall)
      .where(and(eq(hall.id, hallId), eq(hall.studioId, studioId)))
      .for('update');
    if (!locked[0]) throw ApiError.notFound('Hall not found');
  }

  private async rewriteIndexes(
    tx: HallTx,
    orderedIds: string[],
  ): Promise<void> {
    const shift = 1_000_000;
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (!id) continue;
      await tx
        .update(hallFile)
        .set({ index: shift + index })
        .where(eq(hallFile.id, id));
    }
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (!id) continue;
      await tx.update(hallFile).set({ index }).where(eq(hallFile.id, id));
    }
  }

  private async read(studioId: string, id: string): Promise<HallView> {
    const rows = await this.db
      .select()
      .from(hall)
      .where(and(eq(hall.id, id), eq(hall.studioId, studioId)));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Hall not found');
    const images = await this.imagesOf([row.id]);
    return toHall(row, images.get(row.id) ?? []);
  }

  private async imagesOf(hallIds: string[]) {
    const grouped = new Map<string, HallFileView[]>();
    if (hallIds.length === 0) return grouped;
    const rows = await this.db
      .select({
        id: hallFile.id,
        hallId: hallFile.hallId,
        index: hallFile.index,
        contentType: hallFile.contentType,
        storagePath: hallFile.storagePath,
      })
      .from(hallFile)
      .where(inArray(hallFile.hallId, hallIds))
      .orderBy(asc(hallFile.index));
    for (const row of rows) {
      const list = grouped.get(row.hallId) ?? [];
      list.push({
        id: row.id,
        index: row.index,
        kind: row.contentType.startsWith('video/') ? 'video' : 'image',
        contentType: row.contentType,
        url: row.storagePath,
      });
      grouped.set(row.hallId, list);
    }
    return grouped;
  }
}

function toHall(
  row: typeof hall.$inferSelect,
  images: HallFileView[],
): HallView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    videoLink: row.videoLink,
    images,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type HallTx = Parameters<Parameters<Database['transaction']>[0]>[0];

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function fileMessage(code: string): string {
  if (code === FieldErrorCode.TOO_SMALL) return 'File is empty';
  if (code === FieldErrorCode.TOO_BIG) return 'File is too large';
  if (code === FieldErrorCode.REQUIRED) return 'Choose a file';
  return 'File type is not allowed';
}

async function deleteUploads(paths: string[]) {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

async function discardTemps(paths: string[]) {
  await Promise.all(
    paths.map(async (path) => {
      await rm(path, { force: true });
      await rm(dirname(path), { recursive: true, force: true });
    }),
  );
}

async function moveIntoStorage(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if (!isCrossDevice(error)) throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
  await rm(dirname(from), { recursive: true, force: true });
}

function isCrossDevice(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EXDEV'
  );
}
