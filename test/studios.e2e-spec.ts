import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/apis/platform/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

describe('studios', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    token = await adminToken();
  });

  it('creates a studio, lowercases the address, and lists the newest first', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ subdomain: 'Yoga-2', customDomain: 'YogaSpace.com' }));
    expect(created.status).toBe(201);
    expect(created.body.subdomain).toBe('yoga-2');
    expect(created.body.customDomain).toBe('yogaspace.com');
    expect(created.body.status).toBe('active');
    expect(created.body.owner).toEqual({ email: 'owner@example.com' });

    await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ name: 'Older', subdomain: 'older' }));

    const pool = ownerPool();
    await pool.query(
      `update studio set created_at = now() - interval '1 day' where subdomain = 'older'`,
    );
    await pool.end();

    const list = await request(app.getHttpServer())
      .get('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(
      list.body.items.map((item: { subdomain: string }) => item.subdomain),
    ).toEqual(['yoga-2', 'older']);
    expect(list.body.meta.totalItems).toBe(2);
  });

  it('rejects format boundaries and reports every format error together', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'A',
        subdomain: '1',
        customDomain: 'https://bad',
        owner: { email: 'not-an-email' },
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(
      res.body.errors.map((error: { field: string }) => error.field).sort(),
    ).toEqual(['customDomain', 'name', 'owner.email', 'subdomain'].sort());
  });

  it('rejects a subdomain of length 2, 21, a trailing hyphen, and a leading digit', async () => {
    for (const subdomain of ['ab', 'a'.repeat(21), 'ab-', '1abc']) {
      const res = await request(app.getHttpServer())
        .post('/api/platform/studios')
        .set('Authorization', `Bearer ${token}`)
        .send(body({ subdomain }));
      expect({ subdomain, status: res.status, code: res.body.code }).toEqual({
        subdomain,
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
  });

  it('accepts subdomain lengths 3 and 20', async () => {
    for (const subdomain of ['abc', `${'a'.repeat(19)}b`]) {
      const res = await request(app.getHttpServer())
        .post('/api/platform/studios')
        .set('Authorization', `Bearer ${token}`)
        .send(body({ subdomain }));
      expect(res.status).toBe(201);
    }
  });

  it('reserves api, admin, app, and www', async () => {
    for (const subdomain of ['api', 'admin', 'app', 'www']) {
      const res = await request(app.getHttpServer())
        .post('/api/platform/studios')
        .set('Authorization', `Bearer ${token}`)
        .send(body({ subdomain }));
      expect(res.body.code).toBe('SUBDOMAIN_RESERVED');
    }
  });

  it('keeps a subdomain taken, including for a deactivated studio', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ subdomain: 'taken' }));
    const pool = ownerPool();
    await pool.query(
      `update studio set status = 'deactivated' where subdomain = 'taken'`,
    );
    await pool.end();
    const again = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ subdomain: 'Taken' }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SUBDOMAIN_TAKEN');
  });

  it('rejects a platform domain and a label that starts with a hyphen', async () => {
    const platform = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ customDomain: 'www.studio-desk.axondigital.xyz' }));
    expect(platform.body.code).toBe('VALIDATION_ERROR');

    const edge = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ customDomain: '-bad.com' }));
    expect(edge.body.code).toBe('VALIDATION_ERROR');
  });

  it('stores an empty custom domain as null and rejects a duplicate domain', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ customDomain: '   ' }));
    expect(created.body.customDomain).toBeNull();

    await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ subdomain: 'one', customDomain: 'yoga.com' }));
    const duplicate = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ subdomain: 'two', customDomain: 'YOGA.com' }));
    expect(duplicate.body.code).toBe('DOMAIN_TAKEN');
  });

  it('does not treat % in search as a wildcard', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ name: 'Percent', subdomain: 'percent' }));
    const res = await request(app.getHttpServer())
      .get('/api/platform/studios')
      .query({ search: '%' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.items).toEqual([]);
  });

  it('changes the owner e-mail without touching sessions', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const updated = await request(app.getHttpServer())
      .patch(`/api/platform/studios/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ owner: { email: 'New@Example.com' } });
    expect(updated.status).toBe(200);
    expect(updated.body.owner).toEqual({ email: 'new@example.com' });
    expect(updated.body.subdomain).toBe('yoga');
  });

  it('hides a missing studio and a request without a token', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/platform/studios/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);

    const closed = await request(app.getHttpServer()).get(
      '/api/platform/studios',
    );
    expect(closed.status).toBe(401);
  });
});

function body(over: Record<string, unknown> = {}) {
  return {
    name: 'Yoga Space',
    subdomain: 'yoga',
    owner: { email: 'owner@example.com' },
    ...over,
  };
}

async function adminToken() {
  const pool = ownerPool();
  const admin = await pool.query<{ id: string }>(
    `insert into platform_administrator (email) values ('admin@example.com') returning id`,
  );
  const session = await pool.query<{ id: string }>(
    `insert into session (platform_administrator_id, api, expires_at, refresh_token_hash)
     values ($1, 'platform', now() + interval '1 day', gen_random_uuid()::text)
     returning id`,
    [admin.rows[0]?.id],
  );
  await pool.end();
  const adminId = admin.rows[0]?.id;
  const sessionId = session.rows[0]?.id;
  if (!adminId || !sessionId) throw new Error('admin session was not created');
  return signAccessToken(
    { sub: adminId, sid: sessionId, api: 'platform' },
    loadEnv().ACCESS_TOKEN_SECRET,
  );
}
