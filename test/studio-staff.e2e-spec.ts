import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

const OWNER = 'owner@example.com';
const OLGA = 'olga@example.com';

describe('studio staff and access', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function sql<T extends object = object>(
    text: string,
    params: unknown[] = [],
  ) {
    const pool = ownerPool();
    try {
      const { rows } = await pool.query<T>(text, params);
      return rows;
    } finally {
      await pool.end();
    }
  }

  async function createStudio(name: string, owner = OWNER) {
    const subdomain = name.toLowerCase().replace(/\s+/g, '-');
    const rows = await sql<{ id: string }>(
      `insert into studio (name, subdomain, owner_email) values ($1, $2, $3) returning id`,
      [name, subdomain, owner],
    );
    return rows[0]!.id;
  }

  async function sessionFor(
    studioId: string,
    email: string,
    impersonatedBy: string | null = null,
  ) {
    const rows = await sql<{ id: string }>(
      `insert into studio_session (studio_id, email, expires_at, refresh_token_hash, impersonated_by)
       values ($1, $2, now() + interval '1 day', gen_random_uuid()::text, $3)
       returning id`,
      [studioId, email, impersonatedBy],
    );
    return signAccessToken(
      { sub: email, sid: rows[0]!.id, api: 'studio', studioId },
      loadEnv().ACCESS_TOKEN_SECRET,
    );
  }

  function authed(token: string) {
    return {
      get: (path: string) =>
        http().get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown>) =>
        http().post(path).set('Authorization', `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown>) =>
        http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
      del: (path: string) =>
        http().delete(path).set('Authorization', `Bearer ${token}`),
    };
  }

  it('tells the owner who they are, including every section from the table', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const me = await owner.get('/api/studio/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('owner');
    expect(me.body.user).toEqual({ email: OWNER, interfaceLanguage: null });
    expect(me.body.sections).toEqual([
      'schedule',
      'catalogs',
      'clients',
      'subscriptions',
      'accounting',
      'studio-settings',
      'staff',
    ]);
    expect(me.body.impersonated).toBe(false);
    expect(me.body.studios).toEqual([{ id: yoga, name: 'Yoga' }]);

    const seeded = await sql<{ role: string; section: string }>(
      `select role, section from role_section where role = 'trainer' order by section`,
    );
    expect(seeded.map((row) => row.section)).toEqual([
      'accounting',
      'clients',
      'schedule',
    ]);
  });

  it('adds, edits, and removes staff, and the new role is read on the next request', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const owner = authed(await sessionFor(yoga, OWNER));
    await sql(
      `insert into studio_staff (studio_id, email, role) values ($1, $2, 'administrator')`,
      [other, OLGA],
    );
    const elsewhere = await sessionFor(other, OLGA);

    const added = await owner.post('/api/studio/staff', {
      email: 'Olga@Example.com',
      role: 'administrator',
    });
    expect(added.status).toBe(201);
    expect(added.body.email).toBe(OLGA);
    expect(added.body.role).toBe('administrator');

    const olgaToken = await sessionFor(yoga, OLGA);
    const before = await authed(olgaToken).get('/api/studio/me');
    expect(before.body.role).toBe('administrator');
    expect(before.body.sections).toEqual([
      'schedule',
      'catalogs',
      'clients',
      'subscriptions',
    ]);
    expect((await authed(olgaToken).get('/api/studio/settings')).status).toBe(
      403,
    );

    const edited = await owner.patch(`/api/studio/staff/${added.body.id}`, {
      role: 'accountant',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.role).toBe('accountant');
    const after = await authed(olgaToken).get('/api/studio/me');
    expect(after.body.role).toBe('accountant');
    expect(after.body.sections).toEqual(['accounting']);

    const removed = await owner.del(`/api/studio/staff/${added.body.id}`);
    expect(removed.status).toBe(204);
    expect((await authed(olgaToken).get('/api/studio/me')).status).toBe(401);
    expect((await authed(elsewhere).get('/api/studio/me')).status).toBe(200);
  });

  it('rejects a duplicate, the owner address, a bad role, and a staff member opening the list', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    await owner.post('/api/studio/staff', {
      email: OLGA,
      role: 'administrator',
    });

    const again = await owner.post('/api/studio/staff', {
      email: OLGA,
      role: 'accountant',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('STAFF_ALREADY_ADDED');

    const ownerMail = await owner.post('/api/studio/staff', {
      email: OWNER,
      role: 'administrator',
    });
    expect(ownerMail.status).toBe(409);
    expect(ownerMail.body.code).toBe('EMAIL_IS_OWNER');

    const bad = await owner.post('/api/studio/staff', {
      email: 'not-an-email',
      role: 'trainer',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email', code: 'INVALID_FORMAT' }),
        expect.objectContaining({ field: 'role', code: 'INVALID_VALUE' }),
      ]),
    );

    const olga = authed(await sessionFor(yoga, OLGA));
    expect((await olga.get('/api/studio/staff')).status).toBe(403);
    const list = await owner.get('/api/studio/staff');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].email).toBe(OLGA);
  });
});
