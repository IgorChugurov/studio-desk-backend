import { ownerPool, truncateAllTables } from './db.js';

const pool = ownerPool();

beforeEach(async () => {
  await truncateAllTables(pool);
  await pool.query(
    `insert into currency (code) values ('EUR'), ('UAH'), ('USD')`,
  );
});

afterAll(async () => {
  await pool.end();
});
