import { Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import { ZodBody } from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import { settingsPatch } from './studio-settings.js';
import { StudioSettingsService } from './studio-settings.service.js';

@Controller('settings')
export class StudioSettingsController {
  constructor(private readonly settings: StudioSettingsService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description: 'language, country, currency, timeZone',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  get(@Req() request: StudioRequest) {
    return this.settings.get(sessionOf(request));
  }

  @Get('options')
  @ApiResponse({ status: 200, description: 'countries, currencies, timeZones' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  options(@Req() request: StudioRequest) {
    return this.settings.options(sessionOf(request));
  }

  @Patch()
  @ApiResponse({
    status: 200,
    description: 'language, country, currency, timeZone',
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  update(
    @Req() request: StudioRequest,
    @ZodBody(settingsPatch) body: z.infer<typeof settingsPatch>,
  ) {
    return this.settings.update(sessionOf(request), body);
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.studioSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}
