import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import { ZodBody } from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import { WeeksService } from './weeks.service.js';

const dateField = z.iso.date({ error: 'Select a date' });
const choice = z.object({
  rowId: z.uuid(),
  date: dateField,
  choice: z.enum(['keep_existing', 'apply_new'], {
    error: 'Choose keep existing or apply new',
  }),
});
const weeks = {
  templateId: z.uuid(),
  from: dateField,
  to: dateField,
  choices: z.array(choice).optional(),
};

const applyBody = z.object(weeks);
const clearBody = z.object({
  from: dateField,
  to: dateField,
  placeResourceIds: z.array(z.uuid()).nullable().optional(),
  preview: z.boolean().optional(),
});
const replaceBody = z.object({
  ...weeks,
  clear: z.enum(['template_places', 'all_places'], {
    error: 'Choose template places or all places',
  }),
  preview: z.boolean().optional(),
});

@Controller('weeks')
export class WeeksController {
  constructor(private readonly weeks: WeeksService) {}

  @Post('apply')
  @HttpCode(200)
  apply(
    @Req() request: StudioRequest,
    @ZodBody(applyBody) body: z.infer<typeof applyBody>,
  ) {
    return this.weeks.apply(sessionOf(request), body);
  }

  @Post('clear')
  @HttpCode(200)
  clear(
    @Req() request: StudioRequest,
    @ZodBody(clearBody) body: z.infer<typeof clearBody>,
  ) {
    return this.weeks.clear(sessionOf(request), {
      from: body.from,
      to: body.to,
      placeResourceIds: body.placeResourceIds ?? null,
      preview: body.preview ?? false,
    });
  }

  @Post('replace')
  @HttpCode(200)
  replace(
    @Req() request: StudioRequest,
    @ZodBody(replaceBody) body: z.infer<typeof replaceBody>,
  ) {
    return this.weeks.replace(sessionOf(request), {
      ...body,
      preview: body.preview ?? false,
    });
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.organizationSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}
