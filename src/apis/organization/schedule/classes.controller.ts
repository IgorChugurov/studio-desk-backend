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
import { ClassesService } from './classes.service.js';
import { classBody, classPatch } from './schedule-body.js';

const listQuery = z.object({
  from: z.iso.date({ error: 'Select a date' }),
  to: z.iso.date({ error: 'Select a date' }),
  hallId: z.uuid().optional(),
  trainerId: z.uuid().optional(),
});

@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.classes.list(sessionOf(request), query);
  }

  @Post()
  @HttpCode(201)
  create(
    @Req() request: StudioRequest,
    @ZodBody(classBody) body: z.infer<typeof classBody>,
  ) {
    return this.classes.create(sessionOf(request), body);
  }

  @Get(':id')
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.classes.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  update(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(classPatch) body: z.infer<typeof classPatch>,
  ) {
    return this.classes.update(sessionOf(request), parseId(id), body);
  }

  @Post(':id/cancel')
  cancel(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.classes.cancel(sessionOf(request), parseId(id));
  }

  @Post(':id/restore')
  restore(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.classes.restore(sessionOf(request), parseId(id));
  }

  @Post(':id/replace')
  @HttpCode(201)
  replace(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(classBody) body: z.infer<typeof classBody>,
  ) {
    return this.classes.replace(sessionOf(request), parseId(id), body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.classes.remove(sessionOf(request), parseId(id));
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.organizationSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw ApiError.notFound('Class not found');
  return id;
}
