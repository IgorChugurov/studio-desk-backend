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
import { TIME_ZONES } from '../settings/organization-settings.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import { StudioHallsService } from './studio-halls.service.js';
import { isVideoLink } from './video-link.js';

const timeZones = new Set(TIME_ZONES);

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

const createBody = z
  .preprocess(
    // A virtual hall's address is fixed, so it is filled before validation.
    // This keeps `address` a field-level required check for an ordinary hall,
    // in the same order as the other fields.
    (raw) => {
      if (raw && typeof raw === 'object') {
        const value = raw as Record<string, unknown>;
        if (value.type === 'virtual') {
          return { ...value, address: 'Virtual hall' };
        }
      }
      return raw;
    },
    z.object({
      type: hallTypeField().optional(),
      name: requiredText(),
      address: requiredText(),
      timeZone: timeZoneField().optional(),
      description: optionalText().optional(),
      videoLink: videoLinkField().optional(),
    }),
  )
  .transform((value) => ({
    type: (value.type === 'virtual' ? 'virtual' : 'ordinary') as
      'ordinary' | 'virtual',
    name: (value.name as string).trim(),
    address: (value.address as string).trim(),
    timeZone: presentText(value.timeZone),
    description: storedLink(value.description),
    videoLink: storedLink(value.videoLink),
  }));

const orderBody = z.object({
  fileIds: z.array(z.uuid()),
});

const patchBody = z
  .object({
    type: hallTypeField(),
    name: requiredText(),
    address: requiredText(),
    timeZone: timeZoneField(),
    description: optionalText(),
    videoLink: videoLinkField(),
  })
  .partial()
  .transform((value) => {
    const timeZone = presentText(value.timeZone);
    return {
      ...(value.type === undefined
        ? {}
        : { type: value.type as 'ordinary' | 'virtual' }),
      ...(value.name === undefined
        ? {}
        : { name: (value.name as string).trim() }),
      ...(value.address === undefined
        ? {}
        : { address: (value.address as string).trim() }),
      ...(timeZone === undefined ? {} : { timeZone }),
      ...(value.description === undefined
        ? {}
        : { description: storedLink(value.description) }),
      ...(value.videoLink === undefined
        ? {}
        : { videoLink: storedLink(value.videoLink) }),
    };
  });

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

function optionalText() {
  return z.any().superRefine((value, ctx) => {
    if (value === undefined || isBlank(value)) return;
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

function hallTypeField() {
  return z.any().superRefine((value, ctx) => {
    if (value === undefined) return;
    if (value !== 'ordinary' && value !== 'virtual') {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a hall type',
        params: { fieldCode: 'INVALID_VALUE' },
      });
    }
  });
}

function timeZoneField() {
  return z.any().superRefine((value, ctx) => {
    if (value === undefined || isBlank(value)) return;
    if (typeof value !== 'string' || !timeZones.has(value.trim())) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a time zone',
        params: { fieldCode: 'INVALID_VALUE' },
      });
    }
  });
}

function presentText(value: unknown): string | undefined {
  if (value === undefined || isBlank(value)) return undefined;
  return (value as string).trim();
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
  const session = request.organizationSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Hall not found');
  }
  return id;
}
