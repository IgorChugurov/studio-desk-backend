import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { ApiError, FieldErrorCode } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { trainer, trainerFile } from '../../../database/schema/catalog.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { detectContentType, fileRejection } from './file-type.js';
import { readUploadedFiles } from './multipart-files.js';
import {
  diskPathOfAddress,
  fileAddress,
  readFileHeader,
} from './storage-path.js';

export interface TrainerFileView {
  id: string;
  index: number;
  kind: 'image' | 'video';
  contentType: string;
  url: string;
}

export interface TrainerView {
  id: string;
  name: string;
  description: string | null;
  instagram: string | null;
  tiktok: string | null;
  images: TrainerFileView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainerWrite {
  name?: string;
  description?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
}

@Injectable()
export class StudioTrainersService {
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
          eq(trainer.studioId, session.studioId),
          sql`${trainer.name} ilike ${pattern} escape '\\'`,
        )
      : eq(trainer.studioId, session.studioId);
    const totals = await this.db
      .select({ total: count() })
      .from(trainer)
      .where(where);
    const totalItems = totals[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'name' ? trainer.name : trainer.createdAt;
    const direction = query.order === 'ASC' ? asc(column) : desc(column);
    const rows = await this.db
      .select()
      .from(trainer)
      .where(where)
      .orderBy(direction, asc(trainer.id))
      .limit(query.perPage)
      .offset(offset);
    const images = await this.imagesOf(rows.map((row) => row.id));
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items: rows.map((row) => toTrainer(row, images.get(row.id) ?? [])),
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

  async get(session: StudioSessionInfo, id: string): Promise<TrainerView> {
    await this.access.assertSection(session, 'catalogs');
    return this.read(session.studioId, id);
  }

  async create(
    session: StudioSessionInfo,
    input: {
      name: string;
      description: string | null;
      instagram: string | null;
      tiktok: string | null;
    },
  ): Promise<TrainerView> {
    await this.access.assertSection(session, 'catalogs');
    const inserted = await this.db
      .insert(trainer)
      .values({
        studioId: session.studioId,
        name: input.name,
        description: input.description,
        instagram: input.instagram,
        tiktok: input.tiktok,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('trainer was not created');
    return toTrainer(row, []);
  }

  async update(
    session: StudioSessionInfo,
    id: string,
    input: TrainerWrite,
  ): Promise<TrainerView> {
    await this.access.assertSection(session, 'catalogs');
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.instagram === undefined ? {} : { instagram: input.instagram }),
      ...(input.tiktok === undefined ? {} : { tiktok: input.tiktok }),
    };
    if (Object.keys(changes).length > 0) {
      const updated = await this.db
        .update(trainer)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(trainer.id, id), eq(trainer.studioId, session.studioId)))
        .returning({ id: trainer.id });
      if (!updated[0]) throw ApiError.notFound('Trainer not found');
    }
    return this.read(session.studioId, id);
  }

  async upload(
    session: StudioSessionInfo,
    trainerId: string,
    request: Request,
  ): Promise<TrainerView> {
    await this.access.assertSection(session, 'catalogs');
    const accepted = await acceptedFiles(request);
    const placed = await placeFiles('trainers', trainerId, accepted);
    try {
      await this.db.transaction(async (tx) => {
        const locked = await tx
          .select({ id: trainer.id })
          .from(trainer)
          .where(
            and(
              eq(trainer.id, trainerId),
              eq(trainer.studioId, session.studioId),
            ),
          )
          .for('update');
        if (!locked[0]) throw ApiError.notFound('Trainer not found');
        const existing = await tx
          .select({ id: trainerFile.id })
          .from(trainerFile)
          .where(eq(trainerFile.trainerId, trainerId));
        let index = existing.length;
        for (const file of placed) {
          await tx.insert(trainerFile).values({
            id: file.id,
            trainerId,
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
    return this.read(session.studioId, trainerId);
  }

  async removeFile(
    session: StudioSessionInfo,
    trainerId: string,
    fileId: string,
  ): Promise<TrainerView> {
    await this.access.assertSection(session, 'catalogs');
    const storagePath = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: trainer.id })
        .from(trainer)
        .where(
          and(
            eq(trainer.id, trainerId),
            eq(trainer.studioId, session.studioId),
          ),
        )
        .for('update');
      if (!locked[0]) throw ApiError.notFound('Trainer not found');
      const rows = await tx
        .select({ id: trainerFile.id, storagePath: trainerFile.storagePath })
        .from(trainerFile)
        .where(eq(trainerFile.trainerId, trainerId))
        .orderBy(asc(trainerFile.index));
      const target = rows.find((row) => row.id === fileId);
      if (!target) throw ApiError.notFound('File not found');
      await tx.delete(trainerFile).where(eq(trainerFile.id, fileId));
      await rewriteIndexes(
        tx,
        trainerFile,
        rows.filter((row) => row.id !== fileId).map((row) => row.id),
      );
      return target.storagePath;
    });
    await rm(diskPathOfAddress(storagePath), { force: true });
    return this.read(session.studioId, trainerId);
  }

  async reorder(
    session: StudioSessionInfo,
    trainerId: string,
    fileIds: string[],
  ): Promise<TrainerView> {
    await this.access.assertSection(session, 'catalogs');
    await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: trainer.id })
        .from(trainer)
        .where(
          and(
            eq(trainer.id, trainerId),
            eq(trainer.studioId, session.studioId),
          ),
        )
        .for('update');
      if (!locked[0]) throw ApiError.notFound('Trainer not found');
      const rows = await tx
        .select({ id: trainerFile.id })
        .from(trainerFile)
        .where(eq(trainerFile.trainerId, trainerId));
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
            message: 'Send every file of this trainer once, in the new order',
          },
        ]);
      }
      await rewriteIndexes(tx, trainerFile, fileIds);
    });
    return this.read(session.studioId, trainerId);
  }

  private async read(studioId: string, id: string): Promise<TrainerView> {
    const rows = await this.db
      .select()
      .from(trainer)
      .where(and(eq(trainer.id, id), eq(trainer.studioId, studioId)));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Trainer not found');
    const images = await this.imagesOf([row.id]);
    return toTrainer(row, images.get(row.id) ?? []);
  }

  private async imagesOf(ids: string[]) {
    const grouped = new Map<string, TrainerFileView[]>();
    if (ids.length === 0) return grouped;
    const rows = await this.db
      .select({
        id: trainerFile.id,
        trainerId: trainerFile.trainerId,
        index: trainerFile.index,
        contentType: trainerFile.contentType,
        storagePath: trainerFile.storagePath,
      })
      .from(trainerFile)
      .where(inArray(trainerFile.trainerId, ids))
      .orderBy(asc(trainerFile.index));
    for (const row of rows) {
      const list = grouped.get(row.trainerId) ?? [];
      list.push(toFile(row));
      grouped.set(row.trainerId, list);
    }
    return grouped;
  }
}

function toTrainer(
  row: typeof trainer.$inferSelect,
  images: TrainerFileView[],
): TrainerView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instagram: row.instagram,
    tiktok: row.tiktok,
    images,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFile(row: {
  id: string;
  index: number;
  contentType: string;
  storagePath: string;
}): TrainerFileView {
  return {
    id: row.id,
    index: row.index,
    kind: row.contentType.startsWith('video/') ? 'video' : 'image',
    contentType: row.contentType,
    url: row.storagePath,
  };
}

function fileProblem(code: string): string {
  if (code === FieldErrorCode.TOO_SMALL) return 'File is empty';
  if (code === FieldErrorCode.TOO_BIG) return 'File is too large';
  if (code === FieldErrorCode.REQUIRED) return 'Choose a file';
  return 'File type is not allowed';
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

type FileTable = typeof trainerFile;

async function rewriteIndexes(
  tx: CatalogTx,
  table: FileTable,
  orderedIds: string[],
) {
  const shift = 1_000_000;
  for (let index = 0; index < orderedIds.length; index++) {
    const id = orderedIds[index];
    if (!id) continue;
    await tx
      .update(table)
      .set({ index: shift + index })
      .where(eq(table.id, id));
  }
  for (let index = 0; index < orderedIds.length; index++) {
    const id = orderedIds[index];
    if (!id) continue;
    await tx.update(table).set({ index }).where(eq(table.id, id));
  }
}

type CatalogTx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function acceptedFiles(request: Request) {
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
        message: fileProblem(code ?? FieldErrorCode.INVALID_VALUE),
      });
    } else {
      accepted.push({ path: part.path, contentType });
    }
  }
  if (errors.length > 0) {
    await discardTemps(parts.map((part) => part.path));
    throw ApiError.validation(errors);
  }
  return accepted;
}

async function placeFiles(
  folder: 'trainers' | 'class-types',
  recordId: string,
  accepted: { path: string; contentType: string }[],
) {
  const placed: { id: string; address: string; contentType: string }[] = [];
  try {
    for (const part of accepted) {
      const id = randomUUID();
      const address = fileAddress(folder, recordId, id, part.contentType);
      await moveIntoStorage(part.path, diskPathOfAddress(address));
      placed.push({ id, address, contentType: part.contentType });
    }
    return placed;
  } catch (error) {
    await discardTemps(accepted.map((part) => part.path));
    await deleteUploads(placed.map((file) => diskPathOfAddress(file.address)));
    throw error;
  }
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

export { acceptedFiles, placeFiles, deleteUploads, rewriteIndexes };
