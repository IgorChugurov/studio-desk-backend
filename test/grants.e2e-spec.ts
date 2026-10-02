import type pg from 'pg';
import { API_DB_ROLES } from '../src/database/db-roles.js';
import { expectedGrants } from '../src/database/expected-grants.js';
import { ownerPool } from './support/db.js';

/** Real table rights in the database must equal src/database/expected-grants.ts. */
describe('table grants', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = ownerPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('every table in public is listed in expected grants, and vice versa', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(
      Object.keys(expectedGrants).sort(),
    );
  });

  it('API users have exactly the expected rights', async () => {
    const { rows } = await pool.query<{
      table_name: string;
      grantee: string;
      privilege_type: string;
    }>(
      `select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee = any($1)`,
      [API_DB_ROLES],
    );

    const actual: Record<string, Record<string, string[]>> = {};
    for (const table of Object.keys(expectedGrants)) {
      actual[table] = Object.fromEntries(
        API_DB_ROLES.map((role) => [role, []]),
      );
    }
    for (const row of rows) {
      (actual[row.table_name] ??= {})[row.grantee] ??= [];
      actual[row.table_name]![row.grantee]!.push(row.privilege_type);
    }
    for (const byRole of Object.values(actual)) {
      for (const privileges of Object.values(byRole)) privileges.sort();
    }

    const expected = Object.fromEntries(
      Object.entries(expectedGrants).map(([table, byRole]) => [
        table,
        Object.fromEntries(
          Object.entries(byRole).map(([role, privileges]) => [
            role,
            [...privileges].sort(),
          ]),
        ),
      ]),
    );

    expect(actual).toEqual(expected);
  });

  it('API users cannot create tables', async () => {
    for (const role of API_DB_ROLES) {
      const { rows } = await pool.query<{ allowed: boolean }>(
        `select has_schema_privilege($1, 'public', 'CREATE') as allowed`,
        [role],
      );
      expect({ role, allowed: rows[0]!.allowed }).toEqual({
        role,
        allowed: false,
      });
    }
  });
});
