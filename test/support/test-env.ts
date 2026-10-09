import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must run before anything reads the environment: the test database is used
// instead of the working one, whatever .env says.
process.env.APP_ENV = 'test';
process.env.DB_NAME = 'studio_desk_test';
process.env.CORS_EXTRA_ORIGINS = 'http://admin.localhost:3001';
process.env.FILE_STORAGE_DIR = mkdtempSync(
  join(tmpdir(), 'studio-desk-files-'),
);
