import pg from 'pg';
import { loadEnv } from '../../src/config/env.js';
import {
  type ApiDbRole,
  connectionConfig,
  OWNER_DB_ROLE,
} from '../../src/database/db-roles.js';

export function ownerPool() {
  return new pg.Pool(connectionConfig(loadEnv(), OWNER_DB_ROLE));
}

export function apiPool(role: ApiDbRole) {
  return new pg.Pool(connectionConfig(loadEnv(), role));
}

export async function truncateAllTables(pool: pg.Pool) {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const keep = new Set(['currency', 'role_section']);
  const tables = rows
    .filter((r) => !keep.has(r.tablename))
    .map((r) => `"public"."${r.tablename}"`)
    .join(', ');
  if (tables.length === 0) return;
  await pool.query(`truncate ${tables} restart identity cascade`);
}

/** PostgreSQL error code of a failed query, also when wrapped by Drizzle. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string')
      return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export const INSUFFICIENT_PRIVILEGE = '42501';
