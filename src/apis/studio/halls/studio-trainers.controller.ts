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
import { isInstagramLink, isTikTokLink } from './social-link.js';
import { StudioTrainersService } from './studio-trainers.service.js';

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

const createBody = z
  .object({
    name: requiredText(),
    description: optionalText().optional(),
    instagram: socialField(
      isInstagramLink,
      'Enter an Instagram link',
    ).optional(),
    tiktok: socialField(isTikTokLink, 'Enter a TikTok link').optional(),
  })
  .transform((value) => ({
    name: value.name.trim(),
    description: storedText(value.description),
    instagram: storedText(value.instagram),
    tiktok: storedText(value.tiktok),
  }));

const patchBody = z
  .object({
    name: requiredText(),
    description: optionalText(),
    instagram: socialField(isInstagramLink, 'Enter an Instagram link'),
    tiktok: socialField(isTikTokLink, 'Enter a TikTok link'),
  })
  .partial()
  .transform((value) => ({
    ...(value.name === undefined ? {} : { name: value.name.trim() }),
    ...(value.description === undefined
      ? {}
      : { description: storedText(value.description) }),
    ...(value.instagram === undefined
      ? {}
      : { instagram: storedText(value.instagram) }),
    ...(value.tiktok === undefined ? {} : { tiktok: storedText(value.tiktok) }),
  }));

const orderBody = z.object({ fileIds: z.array(z.uuid()) });

@Controller('trainers')
export class StudioTrainersController {
  constructor(private readonly trainers: StudioTrainersService) {}

  @Get()
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.trainers.list(sessionOf(request), query);
  }

  @Post()
  @ApiResponse({ status: 201 })
  create(
    @Req() request: StudioRequest,
    @ZodBody(createBody) body: z.infer<typeof createBody>,
  ) {
    return this.trainers.create(sessionOf(request), body);
  }

  @Get(':id')
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.trainers.get(sessionOf(request), parseId(id, 'Trainer'));
  }

  @Patch(':id')
  update(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(patchBody) body: z.infer<typeof patchBody>,
  ) {
    return this.trainers.update(
      sessionOf(request),
      parseId(id, 'Trainer'),
      body,
    );
  }

  @Post(':id/files')
  upload(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.trainers.upload(
      sessionOf(request),
      parseId(id, 'Trainer'),
      request,
    );
  }

  @Delete(':id/files/:fileId')
  removeFile(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.trainers.removeFile(
      sessionOf(request),
      parseId(id, 'Trainer'),
      parseId(fileId, 'File'),
    );
  }

  @Put(':id/files/order')
  reorder(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(orderBody) body: z.infer<typeof orderBody>,
  ) {
    return this.trainers.reorder(
      sessionOf(request),
      parseId(id, 'Trainer'),
      body.fileIds,
    );
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

function socialField(valid: (value: string) => boolean, message: string) {
  return z.any().superRefine((value, ctx) => {
    if (value === undefined || isBlank(value)) return;
    if (typeof value !== 'string' || !valid(value.trim())) {
      ctx.addIssue({
        code: 'custom',
        message,
        params: { fieldCode: 'INVALID_FORMAT' },
      });
    }
  });
}

function isBlank(value: unknown) {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function storedText(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

function sessionOf(request: StudioRequest) {
  const session = request.studioSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string, name: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound(`${name} not found`);
  }
  return id;
}
