import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';
import { INSERT_ORGANIZATION } from './support/insert-organization.js';

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

  async function sessionFor(organizationId: string, email: string) {
    const rows = await sql<{ id: string }>(
      `insert into organization_session (organization_id, email, expires_at, refresh_token_hash)
       values ($1, $2, now() + interval '1 day', gen_random_uuid()::text)
       returning id`,
      [organizationId, email],
    );
    return signAccessToken(
      { sub: email, sid: rows[0]!.id, api: 'organization', organizationId },
      loadEnv().ACCESS_TOKEN_SECRET,
    );
  }

  async function createStudio() {
    const rows = await sql<{ id: string }>(INSERT_ORGANIZATION, [
      'Yoga Space',
      'yoga',
      OWNER,
      'active',
    ]);
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

    const settings = await owner.get('/api/organization/settings');
    expect(settings.status).toBe(200);
    expect(settings.body).toMatchObject({
      language: 'en',
      country: 'SK',
      currency: 'EUR',
      timeZone: 'Europe/Bratislava',
    });

    const options = await owner.get('/api/organization/settings/options');
    expect(options.status).toBe(200);
    expect(options.body.countries).toContain('SK');
    expect(options.body.currencies).toEqual(['EUR', 'UAH', 'USD']);
    expect(options.body.timeZones).toContain('Europe/Bratislava');

    const saved = await owner.patch('/api/organization/settings', {
      language: 'uk',
      currency: 'UAH',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      language: 'uk',
      country: 'SK',
      currency: 'UAH',
      timeZone: 'Europe/Bratislava',
    });
  });

  it('rejects an empty field and a value outside the list, and keeps the old settings', async () => {
    const id = await createStudio();
    const owner = authed(await sessionFor(id, OWNER));

    const blank = await owner.patch('/api/organization/settings', {
      language: '  ',
      country: null,
    });
    expect(blank.status).toBe(400);
    expect(blank.body.code).toBe('VALIDATION_ERROR');
    expect(blank.body.errors).toEqual([
      expect.objectContaining({ code: 'REQUIRED', field: 'language' }),
      expect.objectContaining({ code: 'REQUIRED', field: 'country' }),
    ]);

    const wrong = await owner.patch('/api/organization/settings', {
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

    const currency = await owner.patch('/api/organization/settings', {
      currency: 'eur',
    });
    expect(currency.status).toBe(400);
    expect(currency.body.errors).toEqual([
      expect.objectContaining({ code: 'INVALID_VALUE', field: 'currency' }),
    ]);

    const still = await owner.get('/api/organization/settings');
    expect(still.body.language).toBe('en');
    expect(still.body.currency).toBe('EUR');
  });

  it('hides settings from staff and from a request without a token', async () => {
    const id = await createStudio();
    await sql(
      `insert into organization_staff (organization_id, email, role) values ($1, $2, 'administrator')`,
      [id, STAFF],
    );
    const staff = authed(await sessionFor(id, STAFF));
    for (const path of [
      '/api/organization/settings',
      '/api/organization/settings/options',
    ]) {
      const res = await staff.get(path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const patched = await staff.patch('/api/organization/settings', {
      language: 'sk',
    });
    expect(patched.status).toBe(403);

    const closed = await http().get('/api/organization/settings');
    expect(closed.status).toBe(401);
  });

  it('reads and updates the copied catalog, schedule, and billing config', async () => {
    const id = await createStudio();
    const owner = authed(await sessionFor(id, OWNER));
    const settings = await owner.get('/api/organization/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.catalogConfig.resourceTypes).toHaveLength(3);
    expect(settings.body.scheduleConfig).toEqual({
      audienceEnabled: true,
      formatEnabled: true,
      statuses: ['planned', 'cancelled'],
    });
    expect(settings.body.billingConfig).toEqual({
      settlementMode: 'subscription',
    });

    const saved = await owner.patch('/api/organization/settings', {
      scheduleConfig: {
        audienceEnabled: false,
        formatEnabled: true,
        statuses: ['cancelled', 'planned', 'confirmed'],
      },
      billingConfig: { settlementMode: 'direct_check' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.scheduleConfig).toEqual({
      audienceEnabled: false,
      formatEnabled: true,
      statuses: ['planned', 'confirmed', 'cancelled'],
    });
    expect(saved.body.billingConfig).toEqual({
      settlementMode: 'direct_check',
    });

    const types = settings.body.catalogConfig.resourceTypes as Array<{
      id: string;
      role: string;
    }>;
    const replacedPlace = await owner.patch('/api/organization/settings', {
      catalogConfig: {
        resourceTypes: types.map((type) =>
          type.role === 'place' ? { ...type, id: undefined } : type,
        ),
      },
    });
    expect(replacedPlace.status).toBe(200);

    await sql(
      `insert into resource (organization_id, resource_type_id, name, type, address, time_zone)
       select $1, id, 'Main', 'ordinary', 'Street 1', 'Europe/Bratislava'
         from organization_resource_type
        where organization_id = $1 and role = 'place'`,
      [id],
    );
    const current = await owner.get('/api/organization/settings');
    const inUse = await owner.patch('/api/organization/settings', {
      catalogConfig: {
        resourceTypes: (
          current.body.catalogConfig.resourceTypes as Array<{
            role: string;
          }>
        ).map((type) =>
          type.role === 'place' ? { ...type, id: undefined } : type,
        ),
      },
    });
    expect(inUse.status).toBe(409);
    expect(inUse.body.code).toBe('RESOURCE_TYPE_IN_USE');
  });

  it('refuses disabling person only when a staff member is linked to that type', async () => {
    const id = await createStudio();
    const owner = authed(await sessionFor(id, OWNER));
    const settings = await owner.get('/api/organization/settings');
    const types = settings.body.catalogConfig.resourceTypes as Array<{
      id: string;
      person: boolean;
    }>;
    const person = types.find((type) => type.person)!;
    const created = await sql<{ id: string }>(
      `insert into resource (organization_id, resource_type_id, name)
       values ($1, $2, 'Anna') returning id`,
      [id, person.id],
    );
    const staff = await sql<{ id: string }>(
      `insert into organization_staff (organization_id, email, role)
       values ($1, 'anna@example.com', 'specialist') returning id`,
      [id],
    );
    await sql(
      `insert into staff_resource (organization_id, staff_id, resource_id)
       values ($1, $2, $3)`,
      [id, staff[0]!.id, created[0]!.id],
    );
    const withoutPerson = {
      catalogConfig: {
        resourceTypes: types.map((type) =>
          type.id === person.id ? { ...type, person: false } : type,
        ),
      },
    };
    const blocked = await owner.patch(
      '/api/organization/settings',
      withoutPerson,
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('RESOURCE_TYPE_IN_USE');

    await sql(`delete from organization_staff where id = $1`, [staff[0]!.id]);
    const allowed = await owner.patch(
      '/api/organization/settings',
      withoutPerson,
    );
    expect(allowed.status).toBe(200);
  });
});
