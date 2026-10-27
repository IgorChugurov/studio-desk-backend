import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';
import { INSERT_ORGANIZATION } from './support/insert-organization.js';

const OWNER = 'owner@example.com';
const DAY = '2026-11-03';

describe('studio schedule', () => {
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

  async function createStudio(name: string) {
    const rows = await sql<{ id: string }>(INSERT_ORGANIZATION, [
      name,
      name.toLowerCase().replace(/\s+/g, '-'),
      OWNER,
      'active',
    ]);
    return rows[0]!.id;
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

  function authed(token: string) {
    return {
      get: (path: string) =>
        http().get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string, body?: Record<string, unknown>) =>
        http()
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .send(body ?? {}),
      patch: (path: string, body: Record<string, unknown>) =>
        http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
      del: (path: string) =>
        http().delete(path).set('Authorization', `Bearer ${token}`),
    };
  }

  async function catalog(owner: ReturnType<typeof authed>) {
    const settings = await owner.get('/api/organization/settings');
    const types = settings.body.catalogConfig.resourceTypes as Array<{
      id: string;
      role: string;
    }>;
    const place = types.find((type) => type.role === 'place')!.id;
    const person = types.find((type) => type.role === 'resource')!.id;
    const offering = types.find((type) => type.role === 'offering')!.id;
    const hall = await owner.post('/api/organization/resources', {
      resourceTypeId: place,
      name: 'Main',
      address: 'Street 1',
      timeZone: 'Europe/Bratislava',
    });
    const other = await owner.post('/api/organization/resources', {
      resourceTypeId: place,
      name: 'Side',
      address: 'Street 2',
      timeZone: 'America/New_York',
    });
    const virtual = await owner.post('/api/organization/resources', {
      resourceTypeId: place,
      type: 'virtual',
      name: 'Online',
      timeZone: 'Europe/Bratislava',
    });
    const trainer = await owner.post('/api/organization/resources', {
      resourceTypeId: person,
      name: 'Anna',
    });
    const boris = await owner.post('/api/organization/resources', {
      resourceTypeId: person,
      name: 'Boris',
    });
    const yoga = await owner.post('/api/organization/resources', {
      resourceTypeId: offering,
      name: 'Yoga',
      defaultDuration: 60,
    });
    return {
      hall: hall.body.id as string,
      other: other.body.id as string,
      virtual: virtual.body.id as string,
      anna: trainer.body.id as string,
      boris: boris.body.id as string,
      yoga: yoga.body.id as string,
      offering,
    };
  }

  function body(
    ids: Awaited<ReturnType<typeof catalog>>,
    extra: Record<string, unknown> = {},
  ) {
    return {
      hallId: ids.hall,
      date: DAY,
      startTime: '10:00',
      durationMinutes: 60,
      trainerIds: [ids.anna],
      classTypeId: ids.yoga,
      audience: 'group',
      format: 'offline',
      places: 8,
      ...extra,
    };
  }

  it('refuses an accountant and limits a trainer to their own class', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const created = await owner.post('/api/organization/classes', body(ids));
    expect(created.status).toBe(201);
    const stranger = await owner.post(
      '/api/organization/classes',
      body(ids, {
        startTime: '12:00',
        trainerIds: [ids.boris],
      }),
    );
    await sql(
      `insert into organization_staff (organization_id, email, role) values ($1, 'books@example.com', 'accountant')`,
      [yoga],
    );
    const accountant = authed(await sessionFor(yoga, 'books@example.com'));
    expect(
      (await accountant.get(`/api/organization/classes?from=${DAY}&to=${DAY}`))
        .status,
    ).toBe(403);

    const staff = await owner.post('/api/organization/staff', {
      email: 'anna@example.com',
      role: 'specialist',
      resourceId: ids.anna,
    });
    expect(staff.status).toBe(201);
    const trainer = authed(await sessionFor(yoga, 'anna@example.com'));
    const list = await trainer.get(
      `/api/organization/classes?from=${DAY}&to=${DAY}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(created.body.id);
    expect(list.body.items[0].past).toBeUndefined();
    expect(
      (await trainer.get(`/api/organization/classes/${stranger.body.id}`))
        .status,
    ).toBe(404);
    expect(
      (await trainer.post('/api/organization/classes', body(ids))).status,
    ).toBe(403);
    expect((await trainer.get('/api/organization/week-templates')).status).toBe(
      403,
    );
    expect(
      (
        await trainer.post('/api/organization/weeks/apply', {
          templateId: created.body.id,
          from: DAY,
          to: DAY,
        })
      ).status,
    ).toBe(403);

    const elsewhere = authed(await sessionFor(other, OWNER));
    expect(
      (await elsewhere.get(`/api/organization/classes/${created.body.id}`))
        .status,
    ).toBe(404);
  });

  it('checks duration, midnight, back-to-back, and occupancy', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    for (const duration of [0, 4, 7, 241]) {
      const refused = await owner.post(
        '/api/organization/classes',
        body(ids, { durationMinutes: duration }),
      );
      expect(refused.status).toBe(400);
    }
    expect(
      (
        await owner.post(
          '/api/organization/classes',
          body(ids, { durationMinutes: 5, startTime: '08:00' }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await owner.post(
          '/api/organization/classes',
          body(ids, { durationMinutes: 240, startTime: '20:00' }),
        )
      ).status,
    ).toBe(201);
    const midnight = await owner.post(
      '/api/organization/classes',
      body(ids, { durationMinutes: 240, startTime: '20:05' }),
    );
    expect(midnight.status).toBe(400);
    expect(midnight.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'startTime',
          message: 'A class must end by midnight',
        }),
      ]),
    );

    const first = await owner.post(
      '/api/organization/classes',
      body(ids, { startTime: '11:00' }),
    );
    const back = await owner.post(
      '/api/organization/classes',
      body(ids, { startTime: '12:00' }),
    );
    expect(back.status).toBe(201);
    const overlap = await owner.post(
      '/api/organization/classes',
      body(ids, { startTime: '11:30' }),
    );
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('HALL_BUSY');
    expect(overlap.body.message).toBe(
      'The hall is busy at this time: Yoga 11:00–12:00',
    );

    await owner.patch(`/api/organization/resources/${ids.other}`, {
      timeZone: 'Europe/Bratislava',
    });
    const across = await owner.post(
      '/api/organization/classes',
      body(ids, {
        hallId: ids.other,
        startTime: '11:00',
      }),
    );
    expect(across.status).toBe(409);
    expect(across.body.code).toBe('TRAINER_BUSY');

    await owner.post(`/api/organization/classes/${first.body.id}/cancel`);
    const afterCancel = await owner.post(
      '/api/organization/classes',
      body(ids, { startTime: '11:00' }),
    );
    expect(afterCancel.status).toBe(201);

    const [one, two] = await Promise.all([
      owner.post(
        '/api/organization/classes',
        body(ids, { startTime: '14:00', trainerIds: [ids.boris] }),
      ),
      owner.post(
        '/api/organization/classes',
        body(ids, { startTime: '14:00', trainerIds: [ids.boris] }),
      ),
    ]);
    const statuses = [one.status, two.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
  });

  it('freezes a started class and keeps replace atomic', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const past = await owner.post(
      '/api/organization/classes',
      body(ids, { date: '2026-10-15', startTime: '10:00' }),
    );
    expect(past.status).toBe(409);
    expect(past.body.code).toBe('CLASS_ALREADY_STARTED');

    const created = await owner.post('/api/organization/classes', body(ids));
    const changed = await owner.patch(
      `/api/organization/classes/${created.body.id}`,
      {
        classTypeId: ids.yoga,
      },
    );
    expect(changed.status).toBe(200);
    const otherType = await owner.post('/api/organization/resources', {
      resourceTypeId: ids.offering,
      name: 'Pilates',
      defaultDuration: 60,
    });
    const refusedType = await owner.patch(
      `/api/organization/classes/${created.body.id}`,
      {
        classTypeId: otherType.body.id,
      },
    );
    expect(refusedType.status).toBe(400);
    expect(refusedType.body.errors[0].field).toBe('classTypeId');

    await owner.patch(`/api/organization/resources/${ids.other}`, {
      timeZone: 'Europe/Bratislava',
    });
    const blocker = await owner.post(
      '/api/organization/classes',
      body(ids, {
        hallId: ids.other,
        startTime: '16:00',
        trainerIds: [ids.boris],
      }),
    );
    const replaced = await owner.post(
      `/api/organization/classes/${created.body.id}/replace`,
      body(ids, {
        classTypeId: otherType.body.id,
        startTime: '16:00',
        trainerIds: [ids.boris],
      }),
    );
    expect(replaced.status).toBe(409);
    const still = await owner.get(
      `/api/organization/classes/${created.body.id}`,
    );
    expect(still.body.cancelled).toBe(false);
    expect(still.body.classTypeId).toBe(ids.yoga);
    expect(replaced.body.id).toBeUndefined();
    void blocker;

    const ok = await owner.post(
      `/api/organization/classes/${created.body.id}/replace`,
      body(ids, {
        classTypeId: otherType.body.id,
        startTime: '18:00',
      }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.classTypeId).toBe(otherType.body.id);
    expect(ok.body.id).not.toBe(created.body.id);
    const old = await owner.get(`/api/organization/classes/${created.body.id}`);
    expect(old.body.cancelled).toBe(true);
  });

  it('enforces format, places, and a trainer with no class-type link', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const virtualFormat = await owner.post(
      '/api/organization/classes',
      body(ids, {
        hallId: ids.virtual,
        format: 'offline',
        places: null,
      }),
    );
    expect(virtualFormat.status).toBe(400);
    const virtualPlaces = await owner.post(
      '/api/organization/classes',
      body(ids, {
        hallId: ids.virtual,
        format: 'online_only',
        places: 4,
      }),
    );
    expect(virtualPlaces.status).toBe(400);
    const online = await owner.post(
      '/api/organization/classes',
      body(ids, {
        hallId: ids.virtual,
        format: 'online_only',
        places: null,
        startTime: '09:00',
      }),
    );
    expect(online.status).toBe(201);

    const missingPlaces = await owner.post(
      '/api/organization/classes',
      body(ids, { places: null, startTime: '13:00' }),
    );
    expect(missingPlaces.status).toBe(400);
    const zero = await owner.post(
      '/api/organization/classes',
      body(ids, { places: 0, startTime: '13:00' }),
    );
    expect(zero.status).toBe(400);
    const person = await owner.post(
      '/api/organization/classes',
      body(ids, {
        audience: 'one_person',
        places: 1,
        startTime: '13:00',
      }),
    );
    expect(person.status).toBe(400);
    const linked = await owner.post(
      '/api/organization/classes',
      body(ids, {
        audience: 'one_person',
        places: null,
        startTime: '13:00',
      }),
    );
    expect(linked.status).toBe(201);
    expect(linked.body.trainerIds).toEqual([ids.anna]);
  });

  it('keeps a template separate from the classes it created', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const first = await owner.post('/api/organization/week-templates', {
      name: 'Morning',
    });
    const again = await owner.post('/api/organization/week-templates', {
      name: 'Morning',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TEMPLATE_NAME_TAKEN');
    const row = await owner.post(
      `/api/organization/week-templates/${first.body.id}/rows`,
      {
        weekday: 'tuesday',
        startTime: '10:00',
        durationMinutes: 60,
        hallId: ids.hall,
        trainerIds: [ids.anna],
        classTypeId: ids.yoga,
        audience: 'group',
        format: 'offline',
        places: 8,
      },
    );
    expect(row.status).toBe(201);
    const created = await owner.post('/api/organization/classes', body(ids));
    await owner.patch(`/api/organization/week-templates/${first.body.id}`, {
      name: 'Evening',
    });
    const classAfter = await owner.get(
      `/api/organization/classes/${created.body.id}`,
    );
    expect(classAfter.body.startTime).toBe('10:00');
    await owner.del(`/api/organization/classes/${created.body.id}`);
    const templateAfter = await owner.get(
      `/api/organization/week-templates/${first.body.id}`,
    );
    expect(templateAfter.body.rows).toHaveLength(1);
    expect(templateAfter.body.name).toBe('Evening');
  });

  it('applies, clears, and replaces weeks in one transaction', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const empty = await owner.post('/api/organization/week-templates', {
      name: 'Empty',
    });
    const appliedEmpty = await owner.post('/api/organization/weeks/apply', {
      templateId: empty.body.id,
      from: DAY,
      to: DAY,
    });
    expect(appliedEmpty.status).toBe(200);
    expect(appliedEmpty.body).toEqual({
      added: 0,
      text: 'Template applied: 0 classes added',
    });

    const template = await owner.post('/api/organization/week-templates', {
      name: 'Week',
    });
    await owner.post(
      `/api/organization/week-templates/${template.body.id}/rows`,
      {
        weekday: 'tuesday',
        startTime: '10:00',
        durationMinutes: 60,
        hallId: ids.hall,
        trainerIds: [ids.anna],
        classTypeId: ids.yoga,
        audience: 'group',
        format: 'offline',
        places: 8,
      },
    );
    const same = await owner.post('/api/organization/classes', body(ids));
    await owner.post(`/api/organization/classes/${same.body.id}/cancel`);
    const skipped = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
    });
    expect(skipped.body.added).toBe(0);
    const cancelled = await owner.get(
      `/api/organization/classes/${same.body.id}`,
    );
    expect(cancelled.body.cancelled).toBe(true);

    await owner.del(`/api/organization/classes/${same.body.id}`);
    const blocking = await owner.post(
      '/api/organization/classes',
      body(ids, { startTime: '10:30', durationMinutes: 30 }),
    );
    const conflict = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('WEEK_CONFLICTS');
    const rowId = conflict.body.conflicts[0].rowId as string;
    const kept = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
      choices: [{ rowId, date: DAY, choice: 'keep_existing' }],
    });
    expect(kept.body.added).toBe(0);
    expect(
      (await owner.get(`/api/organization/classes/${blocking.body.id}`)).status,
    ).toBe(200);

    const replaced = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
      choices: [{ rowId, date: DAY, choice: 'apply_new' }],
    });
    expect(replaced.body.added).toBe(1);
    expect(replaced.body.text).toBe('Template applied: 1 class added');
    expect(
      (await owner.get(`/api/organization/classes/${blocking.body.id}`)).status,
    ).toBe(404);

    const preview = await owner.post('/api/organization/weeks/clear', {
      from: DAY,
      to: DAY,
      preview: true,
    });
    expect(preview.body.text).toBe('1 class will be deleted');
    const cleared = await owner.post('/api/organization/weeks/clear', {
      from: DAY,
      to: DAY,
    });
    expect(cleared.body.text).toBe('Weeks cleared');
    const none = await owner.post('/api/organization/weeks/clear', {
      from: DAY,
      to: DAY,
    });
    expect(none.body.deleted).toBe(0);
  });

  it('keeps hall-clock time and refuses a zone change that double-books a trainer', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const bratislava = await owner.post(
      '/api/organization/classes',
      body(ids, { startTime: '18:00' }),
    );
    const newYork = await owner.post(
      '/api/organization/classes',
      body(ids, {
        hallId: ids.other,
        startTime: '18:00',
      }),
    );
    expect(newYork.status).toBe(201);
    const moved = await owner.patch(
      `/api/organization/resources/${ids.other}`,
      {
        timeZone: 'Europe/Bratislava',
      },
    );
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe('RESOURCE_BUSY');
    expect(moved.body.conflict.classId).toBe(bratislava.body.id);
    expect(moved.body.conflict.start).toBe('18:00');
    const hall = await owner.get(`/api/organization/resources/${ids.other}`);
    expect(hall.body.timeZone).toBe('America/New_York');
    const classAfter = await owner.get(
      `/api/organization/classes/${newYork.body.id}`,
    );
    expect(classAfter.body.startTime).toBe('18:00');
  });
});
