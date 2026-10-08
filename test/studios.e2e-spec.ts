import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
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

  it('changes the owner e-mail', async () => {
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

  describe('status and log in as studio', () => {
    async function createStudio() {
      const res = await request(app.getHttpServer())
        .post('/api/platform/studios')
        .set('Authorization', `Bearer ${token}`)
        .send(body());
      return res.body.id as string;
    }

    function post(path: string) {
      return request(app.getHttpServer())
        .post(`/api/platform/studios/${path}`)
        .set('Authorization', `Bearer ${token}`);
    }

    it('deactivates and activates, and the list follows the filter', async () => {
      const id = await createStudio();

      const off = await post(`${id}/deactivate`);
      expect(off.status).toBe(200);
      expect(off.body.status).toBe('deactivated');
      expect(off.body.id).toBe(id);
      expect(off.body.owner).toEqual({ email: 'owner@example.com' });

      const active = await request(app.getHttpServer())
        .get('/api/platform/studios')
        .set('Authorization', `Bearer ${token}`);
      expect(active.body.items).toHaveLength(0);
      const deactivated = await request(app.getHttpServer())
        .get('/api/platform/studios?status=deactivated')
        .set('Authorization', `Bearer ${token}`);
      expect(deactivated.body.items).toHaveLength(1);

      const on = await post(`${id}/activate`);
      expect(on.status).toBe(200);
      expect(on.body.status).toBe('active');
    });

    it('a repeat call changes nothing', async () => {
      const id = await createStudio();
      const first = await post(`${id}/deactivate`);
      const second = await post(`${id}/deactivate`);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);

      const again = await post(`${id}/activate`);
      const repeat = await post(`${id}/activate`);
      expect(repeat.status).toBe(200);
      expect(repeat.body).toEqual(again.body);
    });

    it('answers 404 for an unknown or malformed id and 401 without a token', async () => {
      for (const action of ['deactivate', 'activate', 'impersonate']) {
        const unknown = await post(
          `00000000-0000-4000-8000-000000000000/${action}`,
        );
        expect({ action, status: unknown.status }).toEqual({
          action,
          status: 404,
        });
        expect(unknown.body.code).toBe('NOT_FOUND');
        const malformed = await post(`not-an-id/${action}`);
        expect(malformed.status).toBe(404);
        const closed = await request(app.getHttpServer()).post(
          `/api/platform/studios/00000000-0000-4000-8000-000000000000/${action}`,
        );
        expect(closed.status).toBe(401);
      }
    });

    it('issues a one-time code for 60 seconds and stores only its hash', async () => {
      const id = await createStudio();
      const first = await post(`${id}/impersonate`);
      expect(first.status).toBe(200);
      expect(first.body.expiresIn).toBe(60);
      expect(typeof first.body.code).toBe('string');
      expect(first.body.code.length).toBeGreaterThanOrEqual(40);
      const second = await post(`${id}/impersonate`);
      expect(second.body.code).not.toBe(first.body.code);

      const pool = ownerPool();
      const rows = await pool.query<{
        code_hash: string;
        studio_id: string;
        used_at: Date | null;
        ttl: number;
      }>(
        `select code_hash, studio_id, used_at,
                extract(epoch from (expires_at - created_at))::int as ttl
           from handoff_code`,
      );
      await pool.end();
      expect(rows.rows).toHaveLength(2);
      for (const row of rows.rows) {
        expect(row.studio_id).toBe(id);
        expect(row.used_at).toBeNull();
        expect(row.ttl).toBe(60);
        expect([first.body.code, second.body.code]).not.toContain(
          row.code_hash,
        );
      }
    });

    it('issues a code for a deactivated studio', async () => {
      const id = await createStudio();
      await post(`${id}/deactivate`);
      const res = await post(`${id}/impersonate`);
      expect(res.status).toBe(200);
      expect(res.body.expiresIn).toBe(60);
    });

    it('revokes open sessions on deactivation, except log-in-as-studio ones', async () => {
      const id = await createStudio();
      const owner = await insertSession(id, 'owner@example.com');
      const staff = await insertSession(id, 'staff@example.com');
      const impersonated = await insertSession(
        id,
        'owner@example.com',
        await adminId(),
      );

      await post(`${id}/deactivate`);
      expect(await revoked(owner)).toBe(true);
      expect(await revoked(staff)).toBe(true);
      expect(await revoked(impersonated)).toBe(false);

      await post(`${id}/activate`);
      expect(await revoked(owner)).toBe(true);
      expect(await revoked(impersonated)).toBe(false);

      await post(`${id}/deactivate`);
      expect(await revoked(impersonated)).toBe(false);
    });
  });

  it('revokes the previous owner sessions, including log-in-as-studio, only in this studio', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const other = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ name: 'Other', subdomain: 'other' }));
    const id = created.body.id as string;
    const owner = await insertSession(id, 'owner@example.com');
    const impersonated = await insertSession(
      id,
      'owner@example.com',
      await adminId(),
    );
    const staff = await insertSession(id, 'staff@example.com');
    const elsewhere = await insertSession(
      other.body.id as string,
      'owner@example.com',
    );

    const updated = await request(app.getHttpServer())
      .patch(`/api/platform/studios/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ owner: { email: 'next@example.com' } });
    expect(updated.status).toBe(200);
    expect(await revoked(owner)).toBe(true);
    expect(await revoked(impersonated)).toBe(true);
    expect(await revoked(staff)).toBe(false);
    expect(await revoked(elsewhere)).toBe(false);
  });

  it('rejects an owner change to a current staff e-mail and leaves the owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const id = created.body.id as string;
    const pool = ownerPool();
    await pool.query(
      `insert into studio_staff (studio_id, email, role) values ($1, 'staff@example.com', 'accountant')`,
      [id],
    );
    await pool.end();

    const updated = await request(app.getHttpServer())
      .patch(`/api/platform/studios/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ owner: { email: 'Staff@Example.com' } });
    expect(updated.status).toBe(409);
    expect(updated.body.code).toBe('OWNER_IS_STAFF');
    expect(updated.body.field).toBe('owner.email');

    const still = await request(app.getHttpServer())
      .get(`/api/platform/studios/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(still.body.owner).toEqual({ email: 'owner@example.com' });
  });

  it('allows an e-mail that is staff of another studio to become the owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const other = await request(app.getHttpServer())
      .post('/api/platform/studios')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ name: 'Other', subdomain: 'other' }));
    const pool = ownerPool();
    await pool.query(
      `insert into studio_staff (studio_id, email, role) values ($1, 'staff@example.com', 'administrator')`,
      [other.body.id],
    );
    await pool.end();

    const updated = await request(app.getHttpServer())
      .patch(`/api/platform/studios/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ owner: { email: 'staff@example.com' } });
    expect(updated.status).toBe(200);
    expect(updated.body.owner).toEqual({ email: 'staff@example.com' });
  });
});

async function adminId() {
  const pool = ownerPool();
  const rows = await pool.query<{ id: string }>(
    `select id from platform_administrator`,
  );
  await pool.end();
  const id = rows.rows[0]?.id;
  if (!id) throw new Error('platform administrator was not created');
  return id;
}

async function insertSession(
  studioId: string,
  email: string,
  impersonatedBy: string | null = null,
) {
  const pool = ownerPool();
  const rows = await pool.query<{ id: string }>(
    `insert into studio_session (studio_id, email, expires_at, refresh_token_hash, impersonated_by)
     values ($1, $2, now() + interval '1 day', gen_random_uuid()::text, $3)
     returning id`,
    [studioId, email, impersonatedBy],
  );
  await pool.end();
  const id = rows.rows[0]?.id;
  if (!id) throw new Error('session was not created');
  return id;
}

async function revoked(sessionId: string) {
  const pool = ownerPool();
  const rows = await pool.query<{ revoked_at: Date | null }>(
    `select revoked_at from studio_session where id = $1`,
    [sessionId],
  );
  await pool.end();
  return rows.rows[0]?.revoked_at != null;
}

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
