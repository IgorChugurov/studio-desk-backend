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
import { StudioHallsService } from './studio-halls.service.js';
import { isVideoLink } from './video-link.js';

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

const hallFields = z.object({
  name: requiredText(),
  address: requiredText(),
  videoLink: videoLinkField(),
});

const createBody = z
  .object({
    name: requiredText(),
    address: requiredText(),
    videoLink: videoLinkField().optional(),
  })
  .transform((value) => ({
    name: value.name.trim(),
    address: value.address.trim(),
    videoLink: storedLink(value.videoLink),
  }));

const orderBody = z.object({
  fileIds: z.array(z.uuid()),
});

const patchBody = hallFields.partial().transform((value) => ({
  ...(value.name === undefined ? {} : { name: value.name.trim() }),
  ...(value.address === undefined ? {} : { address: value.address.trim() }),
  ...(value.videoLink === undefined
    ? {}
    : { videoLink: storedLink(value.videoLink) }),
}));

@Controller('halls')
export class StudioHallsController {
  constructor(private readonly halls: StudioHallsService) {}

  @Get()
  @ApiResponse({ status: 200, description: 'Hall list, each with images' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.halls.list(sessionOf(request), query);
  }

  @Post()
  @ApiResponse({ status: 201, description: 'Hall' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  create(
    @Req() request: StudioRequest,
    @ZodBody(createBody) body: z.infer<typeof createBody>,
  ) {
    return this.halls.create(sessionOf(request), body);
  }

  @Get(':id')
  @ApiResponse({ status: 200, description: 'Hall' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.halls.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  @ApiResponse({ status: 200, description: 'Hall' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  update(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(patchBody) body: z.infer<typeof patchBody>,
  ) {
    return this.halls.update(sessionOf(request), parseId(id), body);
  }

  @Post(':id/files')
  @ApiResponse({ status: 201, description: 'Hall with images' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  upload(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.halls.upload(sessionOf(request), parseId(id), request);
  }

  @Delete(':id/files/:fileId')
  @ApiResponse({ status: 200, description: 'Hall with images reindexed' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  removeFile(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.halls.removeFile(
      sessionOf(request),
      parseId(id),
      parseId(fileId),
    );
  }

  @Put(':id/files/order')
  @ApiResponse({
    status: 200,
    description: 'Hall with images in the new order',
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  reorder(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(orderBody) body: z.infer<typeof orderBody>,
  ) {
    return this.halls.reorder(sessionOf(request), parseId(id), body.fileIds);
  }
}

function requiredText() {
  return z.any().superRefine((value, ctx) => {
    if (isBlank(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'This field is required',
        params: { fieldCode: 'REQUIRED' },
      });
      return;
    }
    if (typeof value !== 'string') {
      ctx.addIssue({
        code: 'invalid_type',
        expected: 'string',
        input: value,
        message: 'Expected a string',
      });
    }
  });
}

function videoLinkField() {
  return z.any().superRefine((value, ctx) => {
    if (value === undefined || isBlank(value)) return;
    if (typeof value !== 'string' || !isVideoLink(value.trim())) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a YouTube or Vimeo link',
        params: { fieldCode: 'INVALID_FORMAT' },
      });
    }
  });
}

function isBlank(value: unknown) {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function storedLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

function sessionOf(request: StudioRequest) {
  const session = request.studioSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Hall not found');
  }
  return id;
}
