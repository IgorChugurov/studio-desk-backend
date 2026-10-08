import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

const OWNER = 'owner@example.com';
const STAFF = 'staff@example.com';

describe('studio settings', () => {
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

  async function sessionFor(studioId: string, email: string) {
    const rows = await sql<{ id: string }>(
      `insert into studio_session (studio_id, email, expires_at, refresh_token_hash)
       values ($1, $2, now() + interval '1 day', gen_random_uuid()::text)
       returning id`,
      [studioId, email],
    );
    return signAccessToken(
      { sub: email, sid: rows[0]!.id, api: 'studio', studioId },
      loadEnv().ACCESS_TOKEN_SECRET,
    );
  }

  async function createStudio() {
    const rows = await sql<{ id: string }>(
      `insert into studio (name, subdomain, owner_email)
       values ('Yoga Space', 'yoga', $1) returning id`,
      [OWNER],
    );
    return rows[0]!.id;
  }

  function authed(token: string) {
    return {
      get: (path: string) =>
        http().get(path).set('Authorization', `Bearer ${token}`),
      patch: (path: string, body: Record<string, unknown>) =>
        http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
    };
  }

  it('gives a new studio the defaults and lets the owner change them', async () => {
    const id = await createStudio();
    const owner = authed(await sessionFor(id, OWNER));

    const settings = await owner.get('/api/studio/settings');
    expect(settings.status).toBe(200);
    expect(settings.body).toEqual({
      language: 'en',
      country: 'SK',
      currency: 'EUR',
      timeZone: 'Europe/Bratislava',
    });

    const options = await owner.get('/api/studio/settings/options');
    expect(options.status).toBe(200);
    expect(options.body.countries).toContain('SK');
    expect(options.body.currencies).toEqual(['EUR', 'UAH', 'USD']);
    expect(options.body.timeZones).toContain('Europe/Bratislava');

    const saved = await owner.patch('/api/studio/settings', {
      language: 'uk',
      currency: 'UAH',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      language: 'uk',
      country: 'SK',
      currency: 'UAH',
      timeZone: 'Europe/Bratislava',
    });
  });

  it('rejects an empty field and a value outside the list, and keeps the old settings', async () => {
    const id = await createStudio();
    const owner = authed(await sessionFor(id, OWNER));

    const blank = await owner.patch('/api/studio/settings', {
      language: '  ',
      country: null,
    });
    expect(blank.status).toBe(400);
    expect(blank.body.code).toBe('VALIDATION_ERROR');
    expect(blank.body.errors).toEqual([
      expect.objectContaining({ code: 'REQUIRED', field: 'language' }),
      expect.objectContaining({ code: 'REQUIRED', field: 'country' }),
    ]);

    const wrong = await owner.patch('/api/studio/settings', {
      language: 'de',
      country: 'sk',
      timeZone: 'europe/bratislava',
    });
    expect(wrong.status).toBe(400);
    expect(
      wrong.body.errors.map((item: { field: string }) => item.field).sort(),
    ).toEqual(['country', 'language', 'timeZone']);
    expect(
      wrong.body.errors.every(
        (item: { code: string }) => item.code === 'INVALID_VALUE',
      ),
    ).toBe(true);

    const currency = await owner.patch('/api/studio/settings', {
      currency: 'eur',
    });
    expect(currency.status).toBe(400);
    expect(currency.body.errors).toEqual([
      expect.objectContaining({ code: 'INVALID_VALUE', field: 'currency' }),
    ]);

    const still = await owner.get('/api/studio/settings');
    expect(still.body.language).toBe('en');
    expect(still.body.currency).toBe('EUR');
  });

  it('hides settings from staff and from a request without a token', async () => {
    const id = await createStudio();
    await sql(
      `insert into studio_staff (studio_id, email, role) values ($1, $2, 'administrator')`,
      [id, STAFF],
    );
    const staff = authed(await sessionFor(id, STAFF));
    for (const path of [
      '/api/studio/settings',
      '/api/studio/settings/options',
    ]) {
      const res = await staff.get(path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const patched = await staff.patch('/api/studio/settings', {
      language: 'sk',
    });
    expect(patched.status).toBe(403);

    const closed = await http().get('/api/studio/settings');
    expect(closed.status).toBe(401);
  });
});
