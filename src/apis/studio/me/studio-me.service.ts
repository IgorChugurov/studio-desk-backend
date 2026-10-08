import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import { interfaceLanguage, studio } from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';

@Injectable()
export class StudioMeService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async get(session: StudioSessionInfo) {
    const current = await this.db
      .select({ id: studio.id, name: studio.name })
      .from(studio)
      .where(eq(studio.id, session.studioId));
    const row = current[0];
    if (!row) throw ApiError.notFound('Studio not found');
    const studios = await this.db.execute<{ id: string; name: string }>(sql`
      select s.id, s.name
        from studio s
       where s.status = 'active'
         and (
           s.owner_email = ${session.email}
           or exists (
             select 1 from studio_staff t
              where t.studio_id = s.id and t.email = ${session.email}
           )
         )
       order by s.name, s.id
    `);
    const language = await this.db
      .select({ language: interfaceLanguage.language })
      .from(interfaceLanguage)
      .where(eq(interfaceLanguage.email, session.email));
    return {
      user: {
        email: session.email,
        interfaceLanguage: language[0]?.language ?? null,
      },
      studio: { id: row.id, name: row.name },
      role: await this.access.roleOf(session),
      sections: await this.access.sectionsOf(session),
      impersonated: session.impersonatedBy !== null,
      studios: studios.rows.map((item) => ({ id: item.id, name: item.name })),
    };
  }

  async setLanguage(session: StudioSessionInfo, language: string) {
    await this.db
      .insert(interfaceLanguage)
      .values({ email: session.email, language })
      .onConflictDoUpdate({
        target: interfaceLanguage.email,
        set: { language },
      });
    return { interfaceLanguage: language };
  }
}
