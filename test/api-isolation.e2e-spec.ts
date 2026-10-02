import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  type Database,
  PLATFORM_DB,
  PUBLIC_DB,
  STUDIO_DB,
} from '../src/database/database.module.js';
import { foundationCheck } from '../src/database/schema/index.js';
import { createTestApp } from './support/app.js';
import { INSUFFICIENT_PRIVILEGE, pgErrorCode } from './support/db.js';

const API_DB = {
  platform: { token: 'PLATFORM_DB', role: 'platform_api' },
  studio: { token: 'STUDIO_DB', role: 'studio_api' },
  public: { token: 'PUBLIC_DB', role: 'public_api' },
} as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('API isolation', () => {
  describe('code of each API references only its own connection', () => {
    for (const [api, own] of Object.entries(API_DB)) {
      it(`src/apis/${api}`, () => {
        const foreign = Object.values(API_DB).filter((other) => other !== own);
        for (const file of sourceFiles(join('src', 'apis', api))) {
          const code = readFileSync(file, 'utf8');
          for (const other of foreign) {
            expect({ file, references: code.includes(other.token) }).toEqual({
              file,
              references: false,
            });
            expect({
              file,
              references: code.includes(`'${other.role}'`),
            }).toEqual({
              file,
              references: false,
            });
          }
        }
      });
    }
  });

  describe('each connection works under its own user, and the database enforces its rights', () => {
    let app: INestApplication;
    let platformDb: Database;
    let studioDb: Database;
    let publicDb: Database;

    beforeAll(async () => {
      app = await createTestApp();
      platformDb = app.get(PLATFORM_DB, { strict: false });
      studioDb = app.get(STUDIO_DB, { strict: false });
      publicDb = app.get(PUBLIC_DB, { strict: false });
    });

    afterAll(async () => {
      await app.close();
    });

    async function whoAmI(db: Database) {
      const { rows } = await db.execute<{ user: string; database: string }>(
        sql`select current_user as "user", current_database() as "database"`,
      );
      return rows[0];
    }

    async function privilegeError(query: Promise<unknown>) {
      try {
        await query;
        return 'allowed';
      } catch (error) {
        return pgErrorCode(error);
      }
    }

    it('connections use their own PostgreSQL users and the test database', async () => {
      expect(await whoAmI(platformDb)).toEqual({
        user: 'platform_api',
        database: 'studio_desk_test',
      });
      expect(await whoAmI(studioDb)).toEqual({
        user: 'studio_api',
        database: 'studio_desk_test',
      });
      expect(await whoAmI(publicDb)).toEqual({
        user: 'public_api',
        database: 'studio_desk_test',
      });
    });

    it('platform_api may read and insert, but not update or delete', async () => {
      await platformDb.insert(foundationCheck).values({ note: 'platform' });
      expect(await platformDb.select().from(foundationCheck)).toHaveLength(1);
      expect(
        await privilegeError(
          platformDb.update(foundationCheck).set({ note: 'changed' }),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await privilegeError(platformDb.delete(foundationCheck))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });

    it('studio_api may read only', async () => {
      expect(await studioDb.select().from(foundationCheck)).toEqual([]);
      expect(
        await privilegeError(
          studioDb.insert(foundationCheck).values({ note: 'studio' }),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('public_api may not even read', async () => {
      expect(
        await privilegeError(publicDb.select().from(foundationCheck)),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});
