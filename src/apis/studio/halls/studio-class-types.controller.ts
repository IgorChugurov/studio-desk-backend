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
import { StudioClassTypesService } from './studio-class-types.service.js';

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

const DURATION_MESSAGE = 'Enter a duration from 5 to 240 minutes in steps of 5';

const createBody = z
  .object({
    name: requiredText(),
    description: optionalText().optional(),
    defaultDuration: durationField(),
    trainerIds: z.array(z.uuid()).optional(),
  })
  .transform((value) => ({
    name: value.name.trim(),
    description: storedText(value.description),
    defaultDuration: value.defaultDuration as number,
    trainerIds: value.trainerIds ?? [],
  }));

const patchBody = z
  .object({
    name: requiredText(),
    description: optionalText(),
    defaultDuration: durationField(),
    trainerIds: z.array(z.uuid()),
  })
  .partial()
  .transform((value) => ({
    ...(value.name === undefined ? {} : { name: value.name.trim() }),
    ...(value.description === undefined
      ? {}
      : { description: storedText(value.description) }),
    ...(value.defaultDuration === undefined
      ? {}
      : { defaultDuration: value.defaultDuration as number }),
    ...(value.trainerIds === undefined ? {} : { trainerIds: value.trainerIds }),
  }));

const orderBody = z.object({ fileIds: z.array(z.uuid()) });

@Controller('class-types')
export class StudioClassTypesController {
  constructor(private readonly classTypes: StudioClassTypesService) {}

  @Get()
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.classTypes.list(sessionOf(request), query);
  }

  @Post()
  @ApiResponse({ status: 201 })
  create(
    @Req() request: StudioRequest,
    @ZodBody(createBody) body: z.infer<typeof createBody>,
  ) {
    return this.classTypes.create(sessionOf(request), body);
  }

  @Get(':id')
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.classTypes.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  update(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(patchBody) body: z.infer<typeof patchBody>,
  ) {
    return this.classTypes.update(sessionOf(request), parseId(id), body);
  }

  @Post(':id/files')
  upload(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.classTypes.upload(sessionOf(request), parseId(id), request);
  }

  @Delete(':id/files/:fileId')
  removeFile(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.classTypes.removeFile(
      sessionOf(request),
      parseId(id),
      parseId(fileId),
    );
  }

  @Put(':id/files/order')
  reorder(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(orderBody) body: z.infer<typeof orderBody>,
  ) {
    return this.classTypes.reorder(
      sessionOf(request),
      parseId(id),
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

function durationField() {
  return z.any().superRefine((value, ctx) => {
    if (value === undefined || value === null) {
      ctx.addIssue({
        code: 'custom',
        message: DURATION_MESSAGE,
        params: { fieldCode: 'REQUIRED' },
      });
      return;
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 5 ||
      value > 240 ||
      value % 5 !== 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message: DURATION_MESSAGE,
        params: { fieldCode: 'INVALID_VALUE' },
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

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Class type not found');
  }
  return id;
}
