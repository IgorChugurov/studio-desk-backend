import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/app.js';
import { fixtureImports } from './support/fixtures.js';

/** Every error comes back in the shared format, without internal details. */
describe('error format', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: fixtureImports });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('invalid body: VALIDATION_ERROR with one entry per failing field', async () => {
    const res = await http()
      .post('/api/platform/fixture/echo')
      .send({ name: 'ab', email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: [
        { code: 'TOO_SMALL', field: 'name', message: expect.any(String) },
        { code: 'INVALID_FORMAT', field: 'email', message: expect.any(String) },
      ],
    });
  });

  it('missing field: REQUIRED', async () => {
    const res = await http()
      .post('/api/platform/fixture/echo')
      .send({ name: 'abc' });
    expect(res.body.errors).toEqual([
      { code: 'REQUIRED', field: 'email', message: expect.any(String) },
    ]);
  });

  it('valid body passes; unknown fields are dropped', async () => {
    const res = await http()
      .post('/api/platform/fixture/echo')
      .send({ name: 'abc', email: 'a@b.co', status: 'Active' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'abc', email: 'a@b.co' });
  });

  it('invalid query: VALIDATION_ERROR', async () => {
    const res = await http().get('/api/platform/fixture/list?page=0');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].field).toBe('page');
  });

  it('malformed JSON: BAD_REQUEST', async () => {
    const res = await http()
      .post('/api/platform/fixture/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('unknown address: NOT_FOUND', async () => {
    const res = await http().get('/api/platform/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('internal error: INTERNAL_ERROR without internal details', async () => {
    const res = await http().get('/api/platform/fixture/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('unauthorized: UNAUTHORIZED in the same format', async () => {
    const res = await http().get('/api/studio/fixture/closed');
    expect(res.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: expect.any(String),
    });
  });
});
