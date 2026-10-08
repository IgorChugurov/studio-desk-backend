import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../../../common/errors/api-error.js';
import { type Database, STUDIO_DB } from '../../../database/database.module.js';
import {
  roleSection,
  studio,
  studioStaff,
} from '../../../database/schema/index.js';
import type { StudioSessionInfo } from '../auth/studio-auth.service.js';

/** Section order returned to the frontend. */
export const SECTIONS = [
  'schedule',
  'catalogs',
  'clients',
  'subscriptions',
  'accounting',
  'studio-settings',
  'staff',
] as const;

export type Section = (typeof SECTIONS)[number];

@Injectable()
export class StudioAccessService {
  constructor(@Inject(STUDIO_DB) private readonly db: Database) {}

  async assertSection(session: StudioSessionInfo, section: Section) {
    const role = await this.roleOf(session);
    const rows = await this.db
      .select({ section: roleSection.section })
      .from(roleSection)
      .where(and(eq(roleSection.role, role), eq(roleSection.section, section)));
    if (rows.length === 0) throw forbidden();
  }

  async roleOf(session: StudioSessionInfo): Promise<string> {
    const owners = await this.db
      .select({ ownerEmail: studio.ownerEmail })
      .from(studio)
      .where(eq(studio.id, session.studioId));
    const owner = owners[0]?.ownerEmail;
    if (!owner) throw ApiError.notFound('Studio not found');
    if (owner === session.email) return 'owner';
    const staff = await this.db
      .select({ role: studioStaff.role })
      .from(studioStaff)
      .where(
        and(
          eq(studioStaff.studioId, session.studioId),
          eq(studioStaff.email, session.email),
        ),
      );
    const role = staff[0]?.role;
    if (!role) throw forbidden();
    return role;
  }

  async sectionsOf(session: StudioSessionInfo): Promise<string[]> {
    const role = await this.roleOf(session);
    const rows = await this.db
      .select({ section: roleSection.section })
      .from(roleSection)
      .where(eq(roleSection.role, role));
    const allowed = new Set(rows.map((row) => row.section));
    return SECTIONS.filter((section) => allowed.has(section));
  }
}

function forbidden() {
  return new ApiError({
    statusCode: 403,
    code: 'FORBIDDEN',
    message: "You don't have access to this page",
  });
}
