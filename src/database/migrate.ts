import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import { connectionConfig, OWNER_DB_ROLE } from './db-roles.js';
import { ensurePlatformAdministrator } from './ensure-platform-administrator.js';

export const MIGRATIONS_FOLDER = join(
  process.cwd(),
  'src',
  'database',
  'migrations',
);

/** Applies all migrations as `studio_desk_owner`. */
export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool(connectionConfig(loadEnv(), OWNER_DB_ROLE));
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    await ensurePlatformAdministrator(pool, loadEnv().PLATFORM_ADMIN_EMAIL);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  console.log('Migrations applied');
}
