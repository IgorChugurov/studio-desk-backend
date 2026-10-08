import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { currency, studio } from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import {
  COUNTRIES,
  TIME_ZONES,
  type StudioSettings,
} from './studio-settings.js';

type Patch = Partial<StudioSettings>;

@Injectable()
export class StudioSettingsService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async get(session: StudioSessionInfo): Promise<StudioSettings> {
    await this.access.assertSection(session, 'studio-settings');
    return this.read(session.studioId);
  }

  async options(session: StudioSessionInfo) {
    await this.access.assertSection(session, 'studio-settings');
    const rows = await this.db
      .select({ code: currency.code })
      .from(currency)
      .orderBy(currency.code);
    return {
      countries: COUNTRIES,
      currencies: rows.map((row) => row.code),
      timeZones: TIME_ZONES,
    };
  }

  async update(
    session: StudioSessionInfo,
    patch: Patch,
  ): Promise<StudioSettings> {
    await this.access.assertSection(session, 'studio-settings');
    if (patch.currency !== undefined) {
      const found = await this.db
        .select({ code: currency.code })
        .from(currency)
        .where(eq(currency.code, patch.currency));
      if (found.length === 0) {
        throw ApiError.validation([
          {
            code: 'INVALID_VALUE',
            field: 'currency',
            message: 'Choose a currency',
          },
        ]);
      }
    }
    const values = {
      ...(patch.language === undefined ? {} : { language: patch.language }),
      ...(patch.country === undefined ? {} : { country: patch.country }),
      ...(patch.currency === undefined ? {} : { currency: patch.currency }),
      ...(patch.timeZone === undefined ? {} : { timeZone: patch.timeZone }),
    };
    if (Object.keys(values).length > 0) {
      await this.db
        .update(studio)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(studio.id, session.studioId));
    }
    return this.read(session.studioId);
  }

  private async read(studioId: string): Promise<StudioSettings> {
    const rows = await this.db
      .select({
        language: studio.language,
        country: studio.country,
        currency: studio.currency,
        timeZone: studio.timeZone,
      })
      .from(studio)
      .where(eq(studio.id, studioId));
    const row = rows[0];
    if (!row) throw ApiError.notFound('Studio not found');
    return row;
  }
}
