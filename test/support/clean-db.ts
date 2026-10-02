import { ownerPool, truncateAllTables } from './db.js';

const pool = ownerPool();

beforeEach(async () => {
  await truncateAllTables(pool);
});

afterAll(async () => {
  await pool.end();
});
