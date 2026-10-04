import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/app.js';

describe('GET /api/platform/version', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is open and names the API and its version', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      api: 'platform',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
  });
});

describe('CORS', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const allowedFor = async (origin: string) => {
    const res = await request(app.getHttpServer())
      .get('/api/platform/version')
      .set('Origin', origin);
    return res.headers['access-control-allow-origin'];
  };

  it('allows the production admin and the origin from CORS_EXTRA_ORIGINS', async () => {
    expect(await allowedFor('https://admin.studio-desk.axondigital.xyz')).toBe(
      'https://admin.studio-desk.axondigital.xyz',
    );
    expect(await allowedFor('http://admin.localhost:3001')).toBe(
      'http://admin.localhost:3001',
    );
  });

  it('does not allow any other origin, including another localhost port', async () => {
    expect(await allowedFor('https://evil.example.com')).toBeUndefined();
    expect(await allowedFor('http://localhost:3001')).toBeUndefined();
  });
});
