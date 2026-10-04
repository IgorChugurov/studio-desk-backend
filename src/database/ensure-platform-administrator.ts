import type pg from 'pg';

/**
 * Makes the single platform administrator row match `email`.
 * Runs as `studio_desk_owner` after migrations. Migrations stay free of
 * environment-specific addresses, and tests truncate the table themselves.
 */
export async function ensurePlatformAdministrator(
  pool: pg.Pool,
  email: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query<{ id: string; email: string }>(
      'select id, email from platform_administrator for update',
    );
    const row = existing.rows[0];
    if (!row) {
      await client.query(
        'insert into platform_administrator (email) values ($1)',
        [normalized],
      );
    } else if (row.email !== normalized) {
      await client.query(
        'update platform_administrator set email = $1 where id = $2',
        [normalized, row.id],
      );
      await client.query(
        `update session
            set revoked_at = now()
          where platform_administrator_id = $1
            and revoked_at is null`,
        [row.id],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
