import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  interfaceLanguage,
  organization,
} from '../../../database/schema/index.js';
import { StudioAccessService } from '../access/studio-access.service.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';
import { readOrganizationConfig } from '../organization-view.js';

@Injectable()
export class StudioMeService {
  constructor(
    @Inject(STUDIO_DB) private readonly db: Database,
    private readonly access: StudioAccessService,
  ) {}

  async get(session: StudioSessionInfo) {
    const current = await this.db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, session.organizationId));
    const row = current[0];
    if (!row) throw ApiError.notFound('Organization not found');
    const studios = await this.db.execute<{ id: string; name: string }>(sql`
      select s.id, s.name
        from organization s
       where s.status = 'active'
         and (
           s.owner_email = ${session.email}
           or exists (
             select 1 from organization_staff t
              where t.organization_id = s.id and t.email = ${session.email}
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
      organization: { id: row.id, name: row.name },
      role: await this.access.roleOf(session),
      sections: await this.access.sectionsOf(session),
      config: await readOrganizationConfig(this.db, session.organizationId),
      impersonated: session.impersonatedBy !== null,
      organizations: studios.rows.map((item) => ({
        id: item.id,
        name: item.name,
      })),
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
