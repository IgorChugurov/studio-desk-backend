import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import {
  ZodBody,
  ZodQuery,
} from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import { rowBody, rowPatch } from './schedule-body.js';
import { WeekTemplatesService } from './week-templates.service.js';

const nameBody = z.object({
  name: z.string().trim().min(1, { error: 'Enter a name' }),
});

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

@Controller('week-templates')
export class WeekTemplatesController {
  constructor(private readonly templates: WeekTemplatesService) {}

  @Get()
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.templates.list(sessionOf(request), query);
  }

  @Post()
  @HttpCode(201)
  create(
    @Req() request: StudioRequest,
    @ZodBody(nameBody) body: z.infer<typeof nameBody>,
  ) {
    return this.templates.create(sessionOf(request), body.name);
  }

  @Get(':id')
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.templates.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  rename(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(nameBody) body: z.infer<typeof nameBody>,
  ) {
    return this.templates.rename(sessionOf(request), parseId(id), body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.templates.remove(sessionOf(request), parseId(id));
  }

  @Post(':id/rows')
  @HttpCode(201)
  addRow(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(rowBody) body: z.infer<typeof rowBody>,
  ) {
    return this.templates.addRow(sessionOf(request), parseId(id), {
      ...body,
      resourceIds: body.resourceIds ?? [],
    });
  }

  @Patch(':id/rows/:rowId')
  updateRow(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @ZodBody(rowPatch) body: z.infer<typeof rowPatch>,
  ) {
    return this.templates.updateRow(
      sessionOf(request),
      parseId(id),
      parseId(rowId),
      body,
    );
  }

  @Delete(':id/rows/:rowId')
  @HttpCode(204)
  removeRow(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @Param('rowId') rowId: string,
  ) {
    return this.templates.removeRow(
      sessionOf(request),
      parseId(id),
      parseId(rowId),
    );
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.organizationSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) throw ApiError.notFound('Not found');
  return id;
}
