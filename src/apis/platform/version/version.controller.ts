import { readFileSync } from 'node:fs';
import { Controller, Get } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { Public } from '../../../common/auth/public.decorator.js';

// package.json is in the working directory locally and in the Docker image.
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};

/** Open on purpose: the frontend uses it to check that it can reach this API. */
@Controller('version')
export class VersionController {
  @Public()
  @Get()
  @ApiResponse({ status: 200, description: 'api, version' })
  get() {
    return { api: 'platform', version };
  }
}
