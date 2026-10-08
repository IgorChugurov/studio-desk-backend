import { Controller, Get, Patch, Req } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import { ZodBody } from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import { StudioMeService } from './studio-me.service.js';

const LANGUAGES = new Set(['en', 'sk', 'uk']);

const languageBody = z
  .object({
    language: z.any().superRefine((value, ctx) => {
      if (
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'This field is required',
          params: { fieldCode: 'REQUIRED' },
        });
        return;
      }
      if (typeof value !== 'string' || !LANGUAGES.has(value.trim())) {
        ctx.addIssue({
          code: 'invalid_value',
          values: [],
          input: value,
          message: 'Choose a language',
        });
      }
    }),
  })
  .transform((value) => ({ language: (value.language as string).trim() }));

@Controller('me')
export class StudioMeController {
  constructor(private readonly me: StudioMeService) {}

  @Get()
  get(@Req() request: StudioRequest) {
    return this.me.get(sessionOf(request));
  }

  @Patch('language')
  setLanguage(
    @Req() request: StudioRequest,
    @ZodBody(languageBody) body: z.infer<typeof languageBody>,
  ) {
    return this.me.setLanguage(sessionOf(request), body.language);
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.studioSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}
