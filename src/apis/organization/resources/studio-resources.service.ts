import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiError, type FieldError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  organization,
  organizationResourceType,
  resource,
  resourceFile,
  resourceRelation,
} from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { retimeHall, zoneConflict } from '../schedule/schedule-db.js';
import { TIME_ZONES } from '../settings/organization-settings.js';
import { detectContentType, fileRejection } from '../halls/file-type.js';
import { readUploadedFiles } from '../halls/multipart-files.js';
import { isInstagramLink, isTikTokLink } from '../halls/social-link.js';
import {
  diskPathOfAddress,
  fileAddress,
  readFileHeader,
} from '../halls/storage-path.js';
import { isVideoLink } from '../halls/video-link.js';

const TIME_ZONE_NAMES = new Set<string>(TIME_ZONES);
const VIRTUAL_ADDRESS = 'Virtual place';
const NAME_MESSAGE = 'Enter a name';
const ADDRESS_MESSAGE = 'Enter an address';
const DURATION_MESSAGE =
  'Enter a duration from 5 to 1440 minutes in steps of 5';

export interface ResourceFileView {
  id: string;
  index: number;
  kind: 'image' | 'video';
  contentType: string;
  url: string;
}

export interface ResourceView {
  id: string;
  resourceTypeId: string;
  name: string;
  type: 'ordinary' | 'virtual' | null;
  address: string | null;
  timeZone: string | null;
  defaultDuration: number | null;
  description: string | null;
  videoLink: string | null;
  instagram: string | null;
  tiktok: string | null;
  relatedResourceIds: string[];
  images: ResourceFileView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceInput {
  resourceTypeId?: unknown;
  name?: unknown;
  type?: unknown;
  address?: unknown;
  timeZone?: unknown;
  defaultDuration?: unknown;
  description?: unknown;
  videoLink?: unknown;
  instagram?: unknown;
  tiktok?: unknown;
  relatedResourceIds?: unknown;
}

interface Cubes {
  geography: boolean;
  duration: boolean;
  showcase: boolean;
  skills: boolean;
}

interface Draft {
  errors: FieldError[];
  name?: string;
  type?: 'ordinary' | 'virtual' | null;
  address?: string | null;
  timeZone?: string;
  defaultDuration?: number;
  description?: string | null;
  videoLink?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  relatedResourceIds?: string[];
}

type ResourceTx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class StudioResourcesService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async list(
    session: StudioSessionInfo,
    query: {
      currentPage: number;
      perPage: number;
      resourceTypeId?: string;
      search?: string;
      sortBy: 'createdAt' | 'name';
      order: 'ASC' | 'DESC';
    },
  ) {
    await this.access.assertSection(session, 'catalogs');
    const pattern = query.search ? likePattern(query.search) : undefined;
    const filters = [eq(resource.organizationId, session.organizationId)];
    if (query.resourceTypeId) {
      filters.push(eq(resource.resourceTypeId, query.resourceTypeId));
    }
    if (pattern) {
      filters.push(sql`${resource.name} ilike ${pattern} escape '\\'`);
    }
    const where = and(...filters);
    const totals = await this.db
      .select({ total: count() })
      .from(resource)
      .where(where);
    const totalItems = totals[0]?.total ?? 0;
    const offset = (query.currentPage - 1) * query.perPage;
    const column = query.sortBy === 'name' ? resource.name : resource.createdAt;
    const direction = query.order === 'ASC' ? asc(column) : desc(column);
    const rows = await this.db
      .select()
      .from(resource)
      .where(where)
      .orderBy(direction, asc(resource.id))
      .limit(query.perPage)
      .offset(offset);
    const ids = rows.map((row) => row.id);
    const images = await this.imagesOf(ids);
    const related = await this.relatedOf(ids);
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / query.perPage);
    return {
      items: rows.map((row) =>
        toResource(row, related.get(row.id) ?? [], images.get(row.id) ?? []),
      ),
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

  async get(session: StudioSessionInfo, id: string): Promise<ResourceView> {
    await this.access.assertSection(session, 'catalogs');
    return this.read(session.organizationId, id);
  }

  async create(
    session: StudioSessionInfo,
    input: ResourceInput,
  ): Promise<ResourceView> {
    await this.access.assertSection(session, 'catalogs');
    const identity = identityErrors(input);
    const typeIdInvalid = identity.some(
      (error) => error.field === 'resourceTypeId',
    );
    if (typeIdInvalid) throw ApiError.validation(identity);
    const resourceTypeId = (input.resourceTypeId as string).trim();
    const typeRow = await this.loadType(session.organizationId, resourceTypeId);
    if (!typeRow) {
      throw identity.length > 0 ? ApiError.validation(identity) : unknownType();
    }
    const cubes = cubesOf(typeRow);
    const draft = parseCubeFields(input, cubes, null);
    const errors = [...identity, ...draft.errors];
    if (errors.length > 0) throw ApiError.validation(errors);
    const timeZone = cubes.geography
      ? (draft.timeZone ??
        (await this.organizationTimeZone(session.organizationId)))
      : null;
    const relatedIds = draft.relatedResourceIds ?? [];
    const id = await this.db.transaction(async (tx) => {
      if (cubes.skills) {
        await this.assertRelated(
          tx,
          session.organizationId,
          typeRow.id,
          null,
          relatedIds,
        );
      }
      const inserted = await tx
        .insert(resource)
        .values({
          organizationId: session.organizationId,
          resourceTypeId: typeRow.id,
          name: draft.name ?? '',
          type: cubes.geography ? (draft.type ?? null) : null,
          address: cubes.geography ? (draft.address ?? null) : null,
          timeZone,
          defaultDuration: cubes.duration
            ? (draft.defaultDuration ?? null)
            : null,
          description: cubes.showcase ? (draft.description ?? null) : null,
          videoLink: cubes.showcase ? (draft.videoLink ?? null) : null,
          instagram: cubes.showcase ? (draft.instagram ?? null) : null,
          tiktok: cubes.showcase ? (draft.tiktok ?? null) : null,
        })
        .returning({ id: resource.id });
      const row = inserted[0];
      if (!row) throw new Error('resource was not created');
      if (cubes.skills && relatedIds.length > 0) {
        await this.replaceRelated(
          tx,
          session.organizationId,
          row.id,
          relatedIds,
        );
      }
      return row.id;
    });
    return this.read(session.organizationId, id);
  }

  async update(
    session: StudioSessionInfo,
    id: string,
    input: ResourceInput,
  ): Promise<ResourceView> {
    await this.access.assertSection(session, 'catalogs');
    const current = await this.loadOwned(session.organizationId, id);
    const cubes = cubesOf(current);
    const draft = parseCubeFields(input, cubes, current);
    if (draft.errors.length > 0) throw ApiError.validation(draft.errors);
    const nextZone = draft.timeZone;
    const zoneChanges = nextZone !== undefined && nextZone !== current.timeZone;
    await this.db.transaction(async (tx) => {
      if (draft.relatedResourceIds !== undefined && cubes.skills) {
        await this.assertRelated(
          tx,
          session.organizationId,
          current.resourceTypeId,
          id,
          draft.relatedResourceIds,
        );
      }
      if (zoneChanges && nextZone) {
        const conflict = await zoneConflict(tx, id, nextZone);
        if (conflict) throw resourceBusy(conflict);
      }
      const changes = columnChanges(draft);
      if (Object.keys(changes).length > 0) {
        await tx
          .update(resource)
          .set({ ...changes, updatedAt: new Date() })
          .where(
            and(
              eq(resource.id, id),
              eq(resource.organizationId, session.organizationId),
            ),
          );
      }
      if (draft.relatedResourceIds !== undefined && cubes.skills) {
        await this.replaceRelated(
          tx,
          session.organizationId,
          id,
          draft.relatedResourceIds,
        );
      }
      if (zoneChanges && nextZone) await retimeHall(tx, id, nextZone);
    });
    return this.read(session.organizationId, id);
  }

  async upload(
    session: StudioSessionInfo,
    resourceId: string,
    request: Request,
  ): Promise<ResourceView> {
    await this.access.assertSection(session, 'catalogs');
    const current = await this.loadOwned(session.organizationId, resourceId);
    if (!current.showcase) throw filesClosed();
    const parts = await readUploadedFiles(request);
    const accepted: { path: string; contentType: string }[] = [];
    const errors: FieldError[] = [];
    if (parts.length === 0) {
      errors.push({
        code: 'REQUIRED',
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
          code: code ?? 'INVALID_VALUE',
          field: 'files',
          message: fileMessage(code ?? 'INVALID_VALUE'),
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
        const fileId = randomUUID();
        const address = fileAddress(resourceId, fileId, part.contentType);
        await moveIntoStorage(part.path, diskPathOfAddress(address));
        placed.push({ id: fileId, address, contentType: part.contentType });
      }
      await this.db.transaction(async (tx) => {
        await this.lockResource(tx, session.organizationId, resourceId);
        const existing = await tx
          .select({ id: resourceFile.id })
          .from(resourceFile)
          .where(eq(resourceFile.resourceId, resourceId));
        let index = existing.length;
        for (const file of placed) {
          await tx.insert(resourceFile).values({
            id: file.id,
            resourceId,
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
    return this.read(session.organizationId, resourceId);
  }

  async removeFile(
    session: StudioSessionInfo,
    resourceId: string,
    fileId: string,
  ): Promise<ResourceView> {
    await this.access.assertSection(session, 'catalogs');
    const current = await this.loadOwned(session.organizationId, resourceId);
    if (!current.showcase) throw filesClosed();
    const storagePath = await this.db.transaction(async (tx) => {
      await this.lockResource(tx, session.organizationId, resourceId);
      const rows = await tx
        .select({
          id: resourceFile.id,
          storagePath: resourceFile.storagePath,
        })
        .from(resourceFile)
        .where(eq(resourceFile.resourceId, resourceId))
        .orderBy(asc(resourceFile.index));
      const target = rows.find((row) => row.id === fileId);
      if (!target) throw ApiError.notFound('File not found');
      await tx.delete(resourceFile).where(eq(resourceFile.id, fileId));
      await this.rewriteIndexes(
        tx,
        rows.filter((row) => row.id !== fileId).map((row) => row.id),
      );
      return target.storagePath;
    });
    await rm(diskPathOfAddress(storagePath), { force: true });
    return this.read(session.organizationId, resourceId);
  }

  async reorder(
    session: StudioSessionInfo,
    resourceId: string,
    fileIds: string[],
  ): Promise<ResourceView> {
    await this.access.assertSection(session, 'catalogs');
    const current = await this.loadOwned(session.organizationId, resourceId);
    if (!current.showcase) throw filesClosed();
    await this.db.transaction(async (tx) => {
      await this.lockResource(tx, session.organizationId, resourceId);
      const rows = await tx
        .select({ id: resourceFile.id })
        .from(resourceFile)
        .where(eq(resourceFile.resourceId, resourceId));
      const currentIds = new Set(rows.map((row) => row.id));
      const sent = new Set(fileIds);
      const same =
        currentIds.size === fileIds.length &&
        sent.size === fileIds.length &&
        fileIds.every((fileId) => currentIds.has(fileId));
      if (!same) {
        throw ApiError.validation([
          {
            code: 'INVALID',
            field: 'fileIds',
            message: 'Send every file of this resource once, in the new order',
          },
        ]);
      }
      await this.rewriteIndexes(tx, fileIds);
    });
    return this.read(session.organizationId, resourceId);
  }

  private async loadType(organizationId: string, resourceTypeId: string) {
    const rows = await this.db
      .select()
      .from(organizationResourceType)
      .where(
        and(
          eq(organizationResourceType.id, resourceTypeId),
          eq(organizationResourceType.organizationId, organizationId),
        ),
      );
    return rows[0];
  }

  private async loadOwned(organizationId: string, id: string) {
    const rows = await this.db
      .select({
        id: resource.id,
        resourceTypeId: resource.resourceTypeId,
        name: resource.name,
        type: resource.type,
        address: resource.address,
        timeZone: resource.timeZone,
        defaultDuration: resource.defaultDuration,
        description: resource.description,
        videoLink: resource.videoLink,
        instagram: resource.instagram,
        tiktok: resource.tiktok,
        geography: organizationResourceType.geography,
        duration: organizationResourceType.duration,
        showcase: organizationResourceType.showcase,
        skills: organizationResourceType.skills,
      })
      .from(resource)
      .innerJoin(
        organizationResourceType,
        eq(organizationResourceType.id, resource.resourceTypeId),
      )
      .where(
        and(eq(resource.id, id), eq(resource.organizationId, organizationId)),
      );
    const row = rows[0];
    if (!row) throw ApiError.notFound('Resource not found');
    return row;
  }

  private async organizationTimeZone(organizationId: string): Promise<string> {
    const rows = await this.db
      .select({ timeZone: organization.timeZone })
      .from(organization)
      .where(eq(organization.id, organizationId));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Organization not found');
    return row.timeZone;
  }

  private async assertRelated(
    tx: ResourceTx,
    organizationId: string,
    resourceTypeId: string,
    selfId: string | null,
    relatedIds: string[],
  ) {
    if (relatedIds.length === 0) return;
    if (selfId && relatedIds.includes(selfId)) throw relatedInvalid();
    const rows = await tx
      .select({
        id: resource.id,
        resourceTypeId: resource.resourceTypeId,
        skills: organizationResourceType.skills,
      })
      .from(resource)
      .innerJoin(
        organizationResourceType,
        eq(organizationResourceType.id, resource.resourceTypeId),
      )
      .where(
        and(
          eq(resource.organizationId, organizationId),
          inArray(resource.id, relatedIds),
        ),
      );
    const valid =
      rows.length === relatedIds.length &&
      rows.every((row) => row.skills && row.resourceTypeId !== resourceTypeId);
    if (!valid) throw relatedInvalid();
  }

  private async replaceRelated(
    tx: ResourceTx,
    organizationId: string,
    resourceId: string,
    relatedIds: string[],
  ) {
    await tx
      .delete(resourceRelation)
      .where(
        or(
          eq(resourceRelation.resourceAId, resourceId),
          eq(resourceRelation.resourceBId, resourceId),
        ),
      );
    for (const otherId of relatedIds) {
      const [resourceAId, resourceBId] = orderedPair(resourceId, otherId);
      await tx.insert(resourceRelation).values({
        organizationId,
        resourceAId,
        resourceBId,
      });
    }
  }

  private async lockResource(
    tx: ResourceTx,
    organizationId: string,
    resourceId: string,
  ) {
    const locked = await tx
      .select({ id: resource.id })
      .from(resource)
      .where(
        and(
          eq(resource.id, resourceId),
          eq(resource.organizationId, organizationId),
        ),
      )
      .for('update');
    if (!locked[0]) throw ApiError.notFound('Resource not found');
  }

  private async rewriteIndexes(tx: ResourceTx, orderedIds: string[]) {
    const shift = 1_000_000;
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (!id) continue;
      await tx
        .update(resourceFile)
        .set({ index: shift + index })
        .where(eq(resourceFile.id, id));
    }
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (!id) continue;
      await tx
        .update(resourceFile)
        .set({ index })
        .where(eq(resourceFile.id, id));
    }
  }

  private async read(
    organizationId: string,
    id: string,
  ): Promise<ResourceView> {
    const rows = await this.db
      .select()
      .from(resource)
      .where(
        and(eq(resource.id, id), eq(resource.organizationId, organizationId)),
      );
    const row = rows[0];
    if (!row) throw ApiError.notFound('Resource not found');
    const images = await this.imagesOf([row.id]);
    const related = await this.relatedOf([row.id]);
    return toResource(row, related.get(row.id) ?? [], images.get(row.id) ?? []);
  }

  private async imagesOf(resourceIds: string[]) {
    const grouped = new Map<string, ResourceFileView[]>();
    if (resourceIds.length === 0) return grouped;
    const rows = await this.db
      .select({
        id: resourceFile.id,
        resourceId: resourceFile.resourceId,
        index: resourceFile.index,
        contentType: resourceFile.contentType,
        storagePath: resourceFile.storagePath,
      })
      .from(resourceFile)
      .where(inArray(resourceFile.resourceId, resourceIds))
      .orderBy(asc(resourceFile.index));
    for (const row of rows) {
      const list = grouped.get(row.resourceId) ?? [];
      list.push({
        id: row.id,
        index: row.index,
        kind: row.contentType.startsWith('video/') ? 'video' : 'image',
        contentType: row.contentType,
        url: row.storagePath,
      });
      grouped.set(row.resourceId, list);
    }
    return grouped;
  }

  private async relatedOf(resourceIds: string[]) {
    const grouped = new Map<string, string[]>();
    if (resourceIds.length === 0) return grouped;
    const wanted = new Set(resourceIds);
    const rows = await this.db
      .select({
        resourceAId: resourceRelation.resourceAId,
        resourceBId: resourceRelation.resourceBId,
      })
      .from(resourceRelation)
      .where(
        or(
          inArray(resourceRelation.resourceAId, resourceIds),
          inArray(resourceRelation.resourceBId, resourceIds),
        ),
      );
    for (const row of rows) {
      if (wanted.has(row.resourceAId)) {
        const list = grouped.get(row.resourceAId) ?? [];
        list.push(row.resourceBId);
        grouped.set(row.resourceAId, list);
      }
      if (wanted.has(row.resourceBId)) {
        const list = grouped.get(row.resourceBId) ?? [];
        list.push(row.resourceAId);
        grouped.set(row.resourceBId, list);
      }
    }
    for (const [id, list] of grouped) {
      list.sort();
      grouped.set(id, list);
    }
    return grouped;
  }
}

function cubesOf(row: {
  geography: boolean;
  duration: boolean;
  showcase: boolean;
  skills: boolean;
}): Cubes {
  return {
    geography: row.geography,
    duration: row.duration,
    showcase: row.showcase,
    skills: row.skills,
  };
}

function identityErrors(input: ResourceInput): FieldError[] {
  const errors: FieldError[] = [];
  if (isBlank(input.resourceTypeId)) {
    errors.push({
      code: 'REQUIRED',
      field: 'resourceTypeId',
      message: 'Enter a resource type',
    });
  } else if (typeof input.resourceTypeId !== 'string') {
    errors.push({
      code: 'INVALID_TYPE',
      field: 'resourceTypeId',
      message: 'Expected a string',
    });
  } else if (!z.uuid().safeParse(input.resourceTypeId.trim()).success) {
    errors.push({
      code: 'INVALID_FORMAT',
      field: 'resourceTypeId',
      message: 'Enter a resource type',
    });
  }
  if (isBlank(input.name)) {
    errors.push({ code: 'REQUIRED', field: 'name', message: NAME_MESSAGE });
  } else if (typeof input.name !== 'string') {
    errors.push({
      code: 'INVALID_TYPE',
      field: 'name',
      message: 'Expected a string',
    });
  }
  return errors;
}

function parseCubeFields(
  input: ResourceInput,
  cubes: Cubes,
  current: { type: string | null } | null,
): Draft {
  const creating = current === null;
  const errors: FieldError[] = [];
  const draft: Draft = { errors };
  if (
    (creating || input.name !== undefined) &&
    typeof input.name === 'string'
  ) {
    draft.name = input.name.trim();
  }

  if (cubes.geography) {
    const typeSent = input.type !== undefined && !isBlank(input.type);
    let type: 'ordinary' | 'virtual' | undefined;
    if (typeSent) {
      if (input.type !== 'ordinary' && input.type !== 'virtual') {
        errors.push({
          code: 'INVALID_VALUE',
          field: 'type',
          message: 'Choose a place type',
        });
      } else {
        type = input.type;
      }
    } else if (creating) {
      type = 'ordinary';
    }
    const effective = type ?? (current?.type as 'ordinary' | 'virtual' | null);
    const addressSent = input.address !== undefined;
    const becomingOrdinary = type === 'ordinary' && current?.type === 'virtual';
    const needsAddress =
      (creating && effective === 'ordinary') ||
      becomingOrdinary ||
      (addressSent && effective === 'ordinary');
    if (effective === 'virtual' && (creating || type === 'virtual')) {
      draft.type = 'virtual';
      draft.address = VIRTUAL_ADDRESS;
    } else if (needsAddress) {
      if (isBlank(input.address)) {
        errors.push({
          code: 'REQUIRED',
          field: 'address',
          message: ADDRESS_MESSAGE,
        });
      } else if (typeof input.address !== 'string') {
        errors.push({
          code: 'INVALID_TYPE',
          field: 'address',
          message: 'Expected a string',
        });
      } else {
        if (type) draft.type = type;
        draft.address = input.address.trim();
      }
    } else if (type && type !== current?.type) {
      draft.type = type;
    }
    if (input.timeZone !== undefined && !isBlank(input.timeZone)) {
      if (
        typeof input.timeZone !== 'string' ||
        !TIME_ZONE_NAMES.has(input.timeZone.trim())
      ) {
        errors.push({
          code: 'INVALID_VALUE',
          field: 'timeZone',
          message: 'Choose a time zone',
        });
      } else {
        draft.timeZone = input.timeZone.trim();
      }
    }
  }

  if (cubes.duration && (creating || input.defaultDuration !== undefined)) {
    if (
      input.defaultDuration === undefined ||
      input.defaultDuration === null ||
      input.defaultDuration === ''
    ) {
      errors.push({
        code: 'REQUIRED',
        field: 'defaultDuration',
        message: DURATION_MESSAGE,
      });
    } else if (!validDuration(input.defaultDuration)) {
      errors.push({
        code: 'INVALID_VALUE',
        field: 'defaultDuration',
        message: DURATION_MESSAGE,
      });
    } else {
      draft.defaultDuration = input.defaultDuration;
    }
  }

  if (cubes.showcase) {
    readText(input.description, creating, 'description', draft, errors);
    readLink(
      input.videoLink,
      creating,
      'videoLink',
      isVideoLink,
      'Enter a YouTube or Vimeo link',
      draft,
      errors,
    );
    readLink(
      input.instagram,
      creating,
      'instagram',
      isInstagramLink,
      'Enter an Instagram link',
      draft,
      errors,
    );
    readLink(
      input.tiktok,
      creating,
      'tiktok',
      isTikTokLink,
      'Enter a TikTok link',
      draft,
      errors,
    );
  }

  if (cubes.skills && (creating || input.relatedResourceIds !== undefined)) {
    if (input.relatedResourceIds === undefined) {
      draft.relatedResourceIds = [];
    } else if (!Array.isArray(input.relatedResourceIds)) {
      errors.push({
        code: 'INVALID_TYPE',
        field: 'relatedResourceIds',
        message: 'Expected a list',
      });
    } else if (
      input.relatedResourceIds.some(
        (id) => typeof id !== 'string' || !z.uuid().safeParse(id).success,
      )
    ) {
      errors.push({
        code: 'INVALID_FORMAT',
        field: 'relatedResourceIds',
        message: 'Expected a list of ids',
      });
    } else {
      draft.relatedResourceIds = [
        ...new Set(
          input.relatedResourceIds.map((id) => (id as string).toLowerCase()),
        ),
      ];
    }
  }
  return draft;
}

function columnChanges(draft: Draft): Partial<Draft> {
  const changes: Partial<Draft> = {};
  if (draft.name !== undefined) changes.name = draft.name;
  if (draft.type !== undefined) changes.type = draft.type;
  if (draft.address !== undefined) changes.address = draft.address;
  if (draft.timeZone !== undefined) changes.timeZone = draft.timeZone;
  if (draft.defaultDuration !== undefined) {
    changes.defaultDuration = draft.defaultDuration;
  }
  if (draft.description !== undefined) changes.description = draft.description;
  if (draft.videoLink !== undefined) changes.videoLink = draft.videoLink;
  if (draft.instagram !== undefined) changes.instagram = draft.instagram;
  if (draft.tiktok !== undefined) changes.tiktok = draft.tiktok;
  return changes;
}

function readText(
  value: unknown,
  creating: boolean,
  field: 'description',
  draft: Draft,
  errors: FieldError[],
) {
  if (!creating && value === undefined) return;
  if (isBlank(value)) {
    draft[field] = null;
    return;
  }
  if (typeof value !== 'string') {
    errors.push({ code: 'INVALID_TYPE', field, message: 'Expected a string' });
    return;
  }
  draft[field] = value.trim();
}

function readLink(
  value: unknown,
  creating: boolean,
  field: 'videoLink' | 'instagram' | 'tiktok',
  valid: (value: string) => boolean,
  message: string,
  draft: Draft,
  errors: FieldError[],
) {
  if (!creating && value === undefined) return;
  if (isBlank(value)) {
    draft[field] = null;
    return;
  }
  if (typeof value !== 'string' || !valid(value.trim())) {
    errors.push({ code: 'INVALID_FORMAT', field, message });
    return;
  }
  draft[field] = value.trim();
}

function validDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 5 &&
    value <= 1440 &&
    value % 5 === 0
  );
}

function isBlank(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function orderedPair(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left];
}

function toResource(
  row: typeof resource.$inferSelect,
  relatedResourceIds: string[],
  images: ResourceFileView[],
): ResourceView {
  return {
    id: row.id,
    resourceTypeId: row.resourceTypeId,
    name: row.name,
    type: row.type as 'ordinary' | 'virtual' | null,
    address: row.address,
    timeZone: row.timeZone,
    defaultDuration: row.defaultDuration,
    description: row.description,
    videoLink: row.videoLink,
    instagram: row.instagram,
    tiktok: row.tiktok,
    relatedResourceIds,
    images,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function unknownType() {
  return ApiError.validation([
    {
      code: 'INVALID_VALUE',
      field: 'resourceTypeId',
      message: 'Choose a resource type of this organization',
    },
  ]);
}

function relatedInvalid() {
  return ApiError.validation([
    {
      code: 'INVALID_VALUE',
      field: 'relatedResourceIds',
      message: 'Choose resources of another skills-enabled type',
    },
  ]);
}

function filesClosed() {
  return ApiError.validation([
    {
      code: 'INVALID_VALUE',
      field: 'files',
      message: 'This resource type has no gallery',
    },
  ]);
}

function resourceBusy(conflict: ApiError) {
  return new ApiError({
    statusCode: 409,
    code: 'RESOURCE_BUSY',
    message: conflict.body.message,
    conflict: conflict.body.conflict,
  });
}

function fileMessage(code: string): string {
  if (code === 'TOO_SMALL') return 'File is empty';
  if (code === 'TOO_BIG') return 'File is too large';
  if (code === 'REQUIRED') return 'Choose a file';
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
