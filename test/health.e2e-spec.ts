import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PUBLIC_DB } from '../src/database/database.module.js';
import { createTestApp } from './support/app.js';

describe('/api/health', () => {
  it('200 when the application and the database work', async () => {
    const app = await createTestApp();
    try {
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('503 when the database is unavailable', async () => {
    let app: INestApplication | undefined;
    try {
      app = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(PUBLIC_DB).useValue({
            execute: () => Promise.reject(new Error('connection refused')),
          }),
      });
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', database: 'unavailable' });
    } finally {
      await app?.close();
    }
  });
});
