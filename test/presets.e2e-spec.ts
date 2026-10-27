import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';
import { FITNESS_PRESET_ID } from './support/insert-organization.js';

const ALL_SECTIONS = [
  'schedule',
  'catalogs',
  'clients',
  'subscriptions',
  'accounting',
  'organization-settings',
  'staff',
];

describe('presets', () => {
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

  const http = () => request(app.getHttpServer());

  it('lists the starter presets and finds one by name', async () => {
    const list = await http()
      .get('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.meta.totalItems).toBe(5);
    expect(
      list.body.items.map((item: { name: string }) => item.name).sort(),
    ).toEqual([
      'Auto Service',
      'Beauty Salon',
      'Fitness Studio',
      'Medical Clinic',
      'OblikFlow Accounting',
    ]);

    const found = await http()
      .get('/api/platform/presets?search=fitness&sortBy=name&order=ASC')
      .set('Authorization', `Bearer ${token}`);
    expect(found.body.items).toEqual([
      expect.objectContaining({
        id: FITNESS_PRESET_ID,
        name: 'Fitness Studio',
        sections: ALL_SECTIONS,
      }),
    ]);
  });

  it('creates a preset and rejects invalid catalog, sections, and a taken name', async () => {
    const created = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send(presetBody());
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Custom Studio');
    expect(created.body.sections).toEqual(['schedule', 'catalogs']);

    const missingLabels = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send(
        presetBody('Missing labels', {
          resourceTypes: [
            {
              ...place(),
              labels: { en: { singular: 'Hall', plural: 'Halls' } },
            },
            person(),
            offering(),
          ],
        }),
      );
    expect(missingLabels.status).toBe(400);
    expect(missingLabels.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'REQUIRED',
          field: 'catalogConfig.resourceTypes.0.labels',
        }),
      ]),
    );

    const noPlace = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send(presetBody('No place', { resourceTypes: [person(), offering()] }));
    expect(noPlace.status).toBe(400);
    expect(noPlace.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_VALUE',
          field: 'catalogConfig.resourceTypes',
          message: 'Exactly one place resource type is required',
        }),
      ]),
    );

    const twoPlaces = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send(
        presetBody('Two places', {
          resourceTypes: [
            place(),
            { ...place(), key: 'place-2' },
            person(),
            offering(),
          ],
        }),
      );
    expect(twoPlaces.status).toBe(400);
    expect(
      twoPlaces.body.errors.some(
        (error: { field: string; message: string }) =>
          error.field === 'catalogConfig.resourceTypes' &&
          error.message === 'Exactly one place resource type is required',
      ),
    ).toBe(true);

    const emptySections = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...presetBody('Empty'), sections: [] });
    expect(emptySections.status).toBe(400);
    expect(emptySections.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'REQUIRED', field: 'sections' }),
      ]),
    );

    const taken = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send(presetBody());
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('PRESET_NAME_TAKEN');
    expect(taken.body.field).toBe('name');
  });

  it('updates, duplicates, and deletes a preset without wiping an organization', async () => {
    const created = await http()
      .post('/api/platform/presets')
      .set('Authorization', `Bearer ${token}`)
      .send(presetBody('Workshop'));
    const updated = await http()
      .patch(`/api/platform/presets/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Workshop Plus' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Workshop Plus');

    const copy = await http()
      .post(`/api/platform/presets/${created.body.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`);
    expect(copy.status).toBe(201);
    expect(copy.body.name).toBe('Workshop Plus (copy)');
    expect(copy.body.id).not.toBe(created.body.id);

    const organization = await http()
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Yoga Space',
        subdomain: 'yoga',
        owner: { email: 'owner@example.com' },
        presetId: FITNESS_PRESET_ID,
      });
    expect(organization.status).toBe(201);

    const removed = await http()
      .delete(`/api/platform/presets/${FITNESS_PRESET_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(204);

    const kept = await http()
      .get(`/api/platform/organizations/${organization.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(kept.status).toBe(200);
    expect(kept.body.preset).toEqual({ id: null, name: 'Fitness Studio' });
    expect(kept.body.sections).toEqual(ALL_SECTIONS);
  });
});

function labels(en: string, sk: string, uk: string) {
  return {
    en: { singular: en, plural: `${en}s` },
    sk: { singular: sk, plural: `${sk}s` },
    uk: { singular: uk, plural: `${uk}s` },
  };
}

function place() {
  return {
    key: 'place',
    role: 'place',
    labels: labels('Hall', 'Sála', 'Зал'),
    geography: true,
    duration: false,
    showcase: true,
    person: false,
    skills: false,
    required: true,
    multiple: false,
    conflictMode: 'strict',
  };
}

function person() {
  return {
    key: 'person',
    role: 'resource',
    labels: labels('Trainer', 'Tréner', 'Тренер'),
    geography: false,
    duration: false,
    showcase: true,
    person: true,
    skills: true,
    required: true,
    multiple: true,
    conflictMode: 'strict',
  };
}

function offering() {
  return {
    key: 'offering',
    role: 'offering',
    labels: labels('Class type', 'Typ lekcie', 'Вид заняття'),
    geography: false,
    duration: true,
    showcase: true,
    person: false,
    skills: true,
    required: true,
    multiple: false,
    conflictMode: 'none',
  };
}

function presetBody(
  name = 'Custom Studio',
  catalogConfig: { resourceTypes: unknown[] } = {
    resourceTypes: [place(), person(), offering()],
  },
) {
  return {
    name,
    description: 'A custom preset',
    sections: ['schedule', 'catalogs'],
    catalogConfig,
    scheduleConfig: {
      audienceEnabled: true,
      formatEnabled: false,
      statuses: ['planned', 'cancelled'],
    },
    billingConfig: { settlementMode: 'subscription' },
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
