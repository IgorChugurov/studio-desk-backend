import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownerPool, truncateAllTables } from './db.js';

const pool = ownerPool();

function presetSeed() {
  const sql = readFileSync(
    join(process.cwd(), 'src/database/migrations/0000_bumpy_nighthawk.sql'),
    'utf8',
  );
  const match = sql.match(/-- seed-presets\n([\s\S]*?)\n-- end-seed-presets/);
  if (!match?.[1]) throw new Error('preset seed markers are missing');
  return match[1];
}

beforeEach(async () => {
  await truncateAllTables(pool);
  await pool.query(presetSeed());
});

afterAll(async () => {
  await pool.end();
});
