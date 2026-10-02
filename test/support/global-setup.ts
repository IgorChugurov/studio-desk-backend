import './test-env.js';
import { runMigrations } from '../../src/database/migrate.js';

export default async function setup() {
  await runMigrations();
}
