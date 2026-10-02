import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { Public } from '../common/auth/public.decorator.js';
import { type Database, PUBLIC_DB } from '../database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PUBLIC_DB) private readonly db: Database) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'ok' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', database: 'unavailable' };
    }
  }
}
