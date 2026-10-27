import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import {
  ZodBody,
  ZodQuery,
} from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import {
  type ResourceInput,
  StudioResourcesService,
} from './studio-resources.service.js';

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  resourceTypeId: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.uuid().optional(),
  ),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

const body = z.object({
  resourceTypeId: z.unknown().optional(),
  name: z.unknown().optional(),
  type: z.unknown().optional(),
  address: z.unknown().optional(),
  timeZone: z.unknown().optional(),
  defaultDuration: z.unknown().optional(),
  description: z.unknown().optional(),
  videoLink: z.unknown().optional(),
  instagram: z.unknown().optional(),
  tiktok: z.unknown().optional(),
  relatedResourceIds: z.unknown().optional(),
});

const orderBody = z.object({
  fileIds: z.array(z.uuid()),
});

@Controller('resources')
export class StudioResourcesController {
  constructor(private readonly resources: StudioResourcesService) {}

  @Get()
  @ApiResponse({ status: 200, description: 'Resource list' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.resources.list(sessionOf(request), query);
  }

  @Post()
  @ApiResponse({ status: 201, description: 'Resource' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  create(@Req() request: StudioRequest, @ZodBody(body) input: ResourceInput) {
    return this.resources.create(sessionOf(request), input);
  }

  @Get(':id')
  @ApiResponse({ status: 200, description: 'Resource' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.resources.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  @ApiResponse({ status: 200, description: 'Resource' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'RESOURCE_BUSY' })
  update(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(body) input: ResourceInput,
  ) {
    return this.resources.update(sessionOf(request), parseId(id), input);
  }

  @Post(':id/files')
  @ApiResponse({ status: 201, description: 'Resource with images' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  upload(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.resources.upload(sessionOf(request), parseId(id), request);
  }

  @Delete(':id/files/:fileId')
  @ApiResponse({ status: 200, description: 'Resource with images reindexed' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  removeFile(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.resources.removeFile(
      sessionOf(request),
      parseId(id),
      parseId(fileId),
    );
  }

  @Put(':id/files/order')
  @ApiResponse({ status: 200, description: 'Resource with images reordered' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  reorder(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(orderBody) input: z.infer<typeof orderBody>,
  ) {
    return this.resources.reorder(
      sessionOf(request),
      parseId(id),
      input.fileIds,
    );
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.organizationSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Resource not found');
  }
  return id;
}
