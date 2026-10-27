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
import { restoreBody, slotBody, slotPatch } from './schedule-body.js';
import { ScheduleSlotsService } from './schedule-slots.service.js';

const listQuery = z.object({
  from: z.iso.date({ error: 'Select a date' }),
  to: z.iso.date({ error: 'Select a date' }),
  resourceId: z.uuid().optional(),
});

@Controller('schedule-slots')
export class ScheduleSlotsController {
  constructor(private readonly slots: ScheduleSlotsService) {}

  @Get()
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.slots.list(sessionOf(request), query);
  }

  @Post()
  @HttpCode(201)
  create(
    @Req() request: StudioRequest,
    @ZodBody(slotBody) body: z.infer<typeof slotBody>,
  ) {
    return this.slots.create(sessionOf(request), {
      ...body,
      resourceIds: body.resourceIds ?? [],
    });
  }

  @Get(':id')
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.slots.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  update(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(slotPatch) body: z.infer<typeof slotPatch>,
  ) {
    return this.slots.update(sessionOf(request), parseId(id), body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.slots.cancel(sessionOf(request), parseId(id));
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(restoreBody) body: z.infer<typeof restoreBody>,
  ) {
    return this.slots.restore(
      sessionOf(request),
      parseId(id),
      body.confirmOverlap === true,
    );
  }

  @Post(':id/replace')
  @HttpCode(201)
  replace(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(slotBody) body: z.infer<typeof slotBody>,
  ) {
    return this.slots.replace(sessionOf(request), parseId(id), {
      ...body,
      resourceIds: body.resourceIds ?? [],
    });
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.slots.remove(sessionOf(request), parseId(id));
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.organizationSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw ApiError.notFound('Slot not found');
  return id;
}
