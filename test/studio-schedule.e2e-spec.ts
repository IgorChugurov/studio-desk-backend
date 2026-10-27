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

  async function catalog(
    owner: ReturnType<typeof authed>,
    options: { places?: number } = {},
  ) {
    const settings = await owner.get('/api/organization/settings');
    const types = settings.body.catalogConfig.resourceTypes as Array<{
      id: string;
      role: string;
      conflictMode: string;
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
    const count = options.places ?? 3;
    const other =
      count > 1
        ? await owner.post('/api/organization/resources', {
            resourceTypeId: place,
            name: 'Side',
            address: 'Street 2',
            timeZone: 'America/New_York',
          })
        : undefined;
    const virtual =
      count > 2
        ? await owner.post('/api/organization/resources', {
            resourceTypeId: place,
            type: 'virtual',
            name: 'Online',
            timeZone: 'Europe/Bratislava',
          })
        : undefined;
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
      other: other?.body.id as string | undefined,
      virtual: virtual?.body.id as string | undefined,
      anna: trainer.body.id as string,
      boris: boris.body.id as string,
      yoga: yoga.body.id as string,
      offering,
      types,
    };
  }

  function body(
    ids: Awaited<ReturnType<typeof catalog>>,
    extra: Record<string, unknown> = {},
  ) {
    return {
      kind: 'service',
      placeResourceId: ids.hall,
      date: DAY,
      startTime: '10:00',
      durationMinutes: 60,
      resourceIds: [ids.yoga, ids.anna],
      audience: 'group',
      format: 'offline',
      places: 8,
      ...extra,
    };
  }

  async function enableStatuses(owner: ReturnType<typeof authed>) {
    const saved = await owner.patch('/api/organization/settings', {
      scheduleConfig: {
        audienceEnabled: true,
        formatEnabled: true,
        statuses: [
          'planned',
          'confirmed',
          'in_progress',
          'completed',
          'cancelled',
          'no_show',
        ],
      },
    });
    expect(saved.status).toBe(200);
  }

  it('limits a specialist to their slots and organization-wide blocks', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const created = await owner.post(
      '/api/organization/schedule-slots',
      body(ids),
    );
    expect(created.status).toBe(201);
    expect(created.body.occupiesResources).toBe(true);
    expect(created.body.status).toBe('planned');
    const stranger = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '12:00', resourceIds: [ids.yoga, ids.boris] }),
    );
    const blocked = await owner.post('/api/organization/schedule-slots', {
      kind: 'block',
      placeResourceId: ids.hall,
      date: DAY,
      startTime: '15:00',
      durationMinutes: 30,
      resourceIds: [],
      note: 'Holiday',
      blocksAll: true,
    });
    expect(blocked.status).toBe(201);
    expect(blocked.body.blocksAll).toBe(true);
    expect(blocked.body.note).toBe('Holiday');
    await sql(
      `insert into organization_staff (organization_id, email, role) values ($1, 'books@example.com', 'accountant')`,
      [yoga],
    );
    const accountant = authed(await sessionFor(yoga, 'books@example.com'));
    expect(
      (
        await accountant.get(
          `/api/organization/schedule-slots?from=${DAY}&to=${DAY}`,
        )
      ).status,
    ).toBe(403);

    const staff = await owner.post('/api/organization/staff', {
      email: 'anna@example.com',
      role: 'specialist',
      resourceId: ids.anna,
    });
    expect(staff.status).toBe(201);
    const trainer = authed(await sessionFor(yoga, 'anna@example.com'));
    const list = await trainer.get(
      `/api/organization/schedule-slots?from=${DAY}&to=${DAY}`,
    );
    expect(list.status).toBe(200);
    const byId = (left: string, right: string) => left.localeCompare(right);
    expect(
      list.body.items.map((item: { id: string }) => item.id).sort(byId),
    ).toEqual([created.body.id, blocked.body.id].sort(byId));
    expect(
      (await trainer.get(`/api/organization/schedule-slots/${blocked.body.id}`))
        .status,
    ).toBe(200);
    expect(
      (
        await trainer.get(
          `/api/organization/schedule-slots/${stranger.body.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await trainer.get(
          `/api/organization/schedule-slots?from=${DAY}&to=${DAY}&resourceId=${ids.boris}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await trainer.post('/api/organization/schedule-slots', body(ids)))
        .status,
    ).toBe(403);
    expect((await trainer.get('/api/organization/week-templates')).status).toBe(
      403,
    );

    const elsewhere = authed(await sessionFor(other, OWNER));
    expect(
      (
        await elsewhere.get(
          `/api/organization/schedule-slots/${created.body.id}`,
        )
      ).status,
    ).toBe(404);
  });

  it('accepts a full day, one place, and refuses a strict overlap', async () => {
    const yoga = await createStudio('Yoga One');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner, { places: 1 });
    const omitted = await owner.post('/api/organization/schedule-slots', {
      ...body(ids),
      placeResourceId: undefined,
    });
    expect(omitted.status).toBe(201);
    expect(omitted.body.placeResourceId).toBe(ids.hall);

    const day = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        startTime: '00:00',
        durationMinutes: 1440,
        date: '2026-11-04',
      }),
    );
    expect(day.status).toBe(201);
    expect(day.body.durationMinutes).toBe(1440);
    const pastMidnight = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '00:05', durationMinutes: 1440 }),
    );
    expect(pastMidnight.status).toBe(400);

    const overlap = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '10:30', confirmOverlap: true }),
    );
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('RESOURCE_BUSY');
    expect(overlap.body.conflict.slotId).toBe(omitted.body.id);
    expect(overlap.body.conflict.resourceId).toBe(ids.hall);

    const back = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        date: '2026-11-05',
        startTime: '11:00',
        durationMinutes: 60,
      }),
    );
    expect(back.status).toBe(201);
    const touching = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { date: '2026-11-05', startTime: '12:00' }),
    );
    expect(touching.status).toBe(201);

    await owner.post(`/api/organization/schedule-slots/${back.body.id}/cancel`);
    const afterCancel = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { date: '2026-11-05', startTime: '11:00' }),
    );
    expect(afterCancel.status).toBe(201);

    const [one, two] = await Promise.all([
      owner.post(
        '/api/organization/schedule-slots',
        body(ids, {
          date: '2026-11-06',
          startTime: '14:00',
          resourceIds: [ids.yoga, ids.boris],
        }),
      ),
      owner.post(
        '/api/organization/schedule-slots',
        body(ids, {
          date: '2026-11-06',
          startTime: '14:00',
          resourceIds: [ids.yoga, ids.boris],
        }),
      ),
    ]);
    const statuses = [one.status, two.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
  });

  it('warns on a soft overlap and on a block, then saves when confirmed', async () => {
    const yoga = await createStudio('Yoga Warn');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const settings = await owner.get('/api/organization/settings');
    const warned = await owner.patch('/api/organization/settings', {
      catalogConfig: {
        resourceTypes: (
          settings.body.catalogConfig.resourceTypes as Array<{
            role: string;
            conflictMode: string;
          }>
        ).map((type) =>
          type.role === 'resource'
            ? { ...type, conflictMode: 'warning' }
            : type,
        ),
      },
    });
    expect(warned.status).toBe(200);
    await owner.patch(`/api/organization/resources/${ids.other}`, {
      timeZone: 'Europe/Bratislava',
    });
    const first = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '18:00' }),
    );
    expect(first.status).toBe(201);
    const soft = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        placeResourceId: ids.other,
        startTime: '18:00',
        resourceIds: [ids.yoga, ids.anna],
      }),
    );
    expect(soft.status).toBe(409);
    expect(soft.body.code).toBe('OVERLAP_WARNING');
    expect(soft.body.conflicts[0].slotId).toBe(first.body.id);
    const saved = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        placeResourceId: ids.other,
        startTime: '18:00',
        resourceIds: [ids.yoga, ids.anna],
        confirmOverlap: true,
      }),
    );
    expect(saved.status).toBe(201);

    const block = await owner.post('/api/organization/schedule-slots', {
      kind: 'block',
      placeResourceId: ids.other,
      date: DAY,
      startTime: '09:00',
      durationMinutes: 60,
      blocksAll: true,
      note: 'Closed',
    });
    expect(block.status).toBe(201);
    const overBlock = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '09:00', resourceIds: [ids.yoga, ids.boris] }),
    );
    expect(overBlock.status).toBe(409);
    expect(overBlock.body.code).toBe('OVERLAP_WARNING');
    const overSaved = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        startTime: '09:00',
        resourceIds: [ids.yoga, ids.boris],
        confirmOverlap: true,
      }),
    );
    expect(overSaved.status).toBe(201);
  });

  it('updates every occupying status and a past slot to completed or no-show', async () => {
    const yoga = await createStudio('Yoga Status');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    await enableStatuses(owner);
    const created = await owner.post(
      '/api/organization/schedule-slots',
      body(ids),
    );
    const confirmed = await owner.patch(
      `/api/organization/schedule-slots/${created.body.id}`,
      { status: 'confirmed' },
    );
    expect(confirmed.body.status).toBe('confirmed');
    expect(confirmed.body.occupiesResources).toBe(true);
    const progress = await owner.patch(
      `/api/organization/schedule-slots/${created.body.id}`,
      { status: 'in_progress' },
    );
    expect(progress.body.occupiesResources).toBe(true);

    await sql(
      `update schedule_slot
          set date = '2026-10-01',
              starts_at = '2026-10-01 08:00:00+00',
              ends_at = '2026-10-01 09:00:00+00'
        where id = $1`,
      [created.body.id],
    );
    await sql(
      `update schedule_slot_resource link
          set during = tstzrange(s.starts_at, s.ends_at, '[)')
         from schedule_slot s
        where link.slot_id = s.id and s.id = $1`,
      [created.body.id],
    );
    const moved = await owner.patch(
      `/api/organization/schedule-slots/${created.body.id}`,
      { startTime: '11:00' },
    );
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe('SLOT_ALREADY_STARTED');
    const completed = await owner.patch(
      `/api/organization/schedule-slots/${created.body.id}`,
      { status: 'completed' },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.occupiesResources).toBe(true);
    const missed = await owner.patch(
      `/api/organization/schedule-slots/${created.body.id}`,
      { status: 'no_show' },
    );
    expect(missed.status).toBe(200);
    expect(missed.body.occupiesResources).toBe(false);

    const future = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '16:00' }),
    );
    const cancelled = await owner.post(
      `/api/organization/schedule-slots/${future.body.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.occupiesResources).toBe(false);
    const frozen = await owner.patch(
      `/api/organization/schedule-slots/${future.body.id}`,
      { note: 'later' },
    );
    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe('SLOT_CANCELLED');
    const restored = await owner.post(
      `/api/organization/schedule-slots/${future.body.id}/restore`,
      {},
    );
    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe('planned');
    expect(restored.body.occupiesResources).toBe(true);
  });

  it('keeps replace atomic and freezes an offering change', async () => {
    const yoga = await createStudio('Yoga Replace');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const past = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { date: '2026-10-15' }),
    );
    expect(past.status).toBe(409);
    expect(past.body.code).toBe('SLOT_ALREADY_STARTED');

    const created = await owner.post(
      '/api/organization/schedule-slots',
      body(ids),
    );
    const otherType = await owner.post('/api/organization/resources', {
      resourceTypeId: ids.offering,
      name: 'Pilates',
      defaultDuration: 60,
    });
    const refused = await owner.patch(
      `/api/organization/schedule-slots/${created.body.id}`,
      { resourceIds: [otherType.body.id, ids.anna] },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.errors[0].field).toBe('resourceIds');

    await owner.patch(`/api/organization/resources/${ids.other}`, {
      timeZone: 'Europe/Bratislava',
    });
    await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        placeResourceId: ids.other,
        startTime: '16:00',
        resourceIds: [ids.yoga, ids.boris],
      }),
    );
    const replaced = await owner.post(
      `/api/organization/schedule-slots/${created.body.id}/replace`,
      body(ids, {
        startTime: '16:00',
        resourceIds: [otherType.body.id, ids.boris],
      }),
    );
    expect(replaced.status).toBe(409);
    const still = await owner.get(
      `/api/organization/schedule-slots/${created.body.id}`,
    );
    expect(still.body.status).toBe('planned');
    expect(still.body.resourceIds).toContain(ids.yoga);

    const ok = await owner.post(
      `/api/organization/schedule-slots/${created.body.id}/replace`,
      body(ids, {
        startTime: '18:00',
        resourceIds: [otherType.body.id, ids.anna],
      }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.resourceIds).toContain(otherType.body.id);
    expect(ok.body.id).not.toBe(created.body.id);
    const old = await owner.get(
      `/api/organization/schedule-slots/${created.body.id}`,
    );
    expect(old.body.status).toBe('cancelled');
    expect(old.body.occupiesResources).toBe(false);
  });

  it('stores service and block rows and applies, clears, and replaces weeks', async () => {
    const yoga = await createStudio('Yoga Weeks');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const template = await owner.post('/api/organization/week-templates', {
      name: 'Week',
    });
    const again = await owner.post('/api/organization/week-templates', {
      name: 'Week',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TEMPLATE_NAME_TAKEN');
    const service = await owner.post(
      `/api/organization/week-templates/${template.body.id}/rows`,
      {
        kind: 'service',
        weekday: 'tuesday',
        startTime: '10:00',
        durationMinutes: 60,
        placeResourceId: ids.hall,
        resourceIds: [ids.yoga, ids.anna],
        audience: 'group',
        format: 'offline',
        places: 8,
      },
    );
    expect(service.status).toBe(201);
    const block = await owner.post(
      `/api/organization/week-templates/${template.body.id}/rows`,
      {
        kind: 'block',
        weekday: 'wednesday',
        startTime: '13:00',
        durationMinutes: 1440,
        placeResourceId: ids.hall,
        note: 'Maintenance',
        blocksAll: true,
      },
    );
    expect(block.status).toBe(400);
    const blockOk = await owner.post(
      `/api/organization/week-templates/${template.body.id}/rows`,
      {
        kind: 'block',
        weekday: 'wednesday',
        startTime: '13:00',
        durationMinutes: 60,
        placeResourceId: ids.hall,
        note: 'Maintenance',
        blocksAll: true,
      },
    );
    expect(blockOk.status).toBe(201);
    expect(blockOk.body.rows).toHaveLength(2);
    const busy = await owner.post(
      `/api/organization/week-templates/${template.body.id}/rows`,
      {
        kind: 'service',
        weekday: 'tuesday',
        startTime: '10:30',
        durationMinutes: 30,
        placeResourceId: ids.hall,
        resourceIds: [ids.yoga, ids.boris],
        audience: 'one_person',
        format: 'offline',
        places: null,
      },
    );
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('RESOURCE_BUSY');

    const same = await owner.post(
      '/api/organization/schedule-slots',
      body(ids),
    );
    await owner.post(`/api/organization/schedule-slots/${same.body.id}/cancel`);
    const skipped = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
    });
    expect(skipped.body.added).toBe(1);
    const cancelled = await owner.get(
      `/api/organization/schedule-slots/${same.body.id}`,
    );
    expect(cancelled.body.status).toBe('cancelled');

    await owner.del(`/api/organization/schedule-slots/${same.body.id}`);
    const blocking = await owner.post(
      '/api/organization/schedule-slots',
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
      (await owner.get(`/api/organization/schedule-slots/${blocking.body.id}`))
        .status,
    ).toBe(200);

    const replaced = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
      choices: [{ rowId, date: DAY, choice: 'apply_new' }],
    });
    expect(replaced.body.added).toBe(1);
    expect(
      (await owner.get(`/api/organization/schedule-slots/${blocking.body.id}`))
        .status,
    ).toBe(404);

    const preview = await owner.post('/api/organization/weeks/clear', {
      from: DAY,
      to: DAY,
      placeResourceIds: [ids.hall],
      preview: true,
    });
    expect(preview.body.deleted).toBeGreaterThan(0);
    const cleared = await owner.post('/api/organization/weeks/clear', {
      from: DAY,
      to: DAY,
      placeResourceIds: [ids.hall],
    });
    expect(cleared.body.text).toBe('Weeks cleared');

    const fresh = await owner.post('/api/organization/weeks/apply', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
    });
    expect(fresh.body.added).toBe(2);
    const swap = await owner.post('/api/organization/weeks/replace', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
      clear: 'template_places',
      preview: true,
    });
    expect(swap.status).toBe(200);
    expect(swap.body.deleted).toBeGreaterThan(0);
    const done = await owner.post('/api/organization/weeks/replace', {
      templateId: template.body.id,
      from: DAY,
      to: DAY,
      clear: 'all_places',
    });
    expect(done.status).toBe(200);
    expect(done.body.text).toBe('Weeks replaced');
  });

  it('refuses a place time-zone change that double-books a strict resource', async () => {
    const yoga = await createStudio('Yoga Zone');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const bratislava = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { startTime: '18:00' }),
    );
    const newYork = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { placeResourceId: ids.other, startTime: '18:00' }),
    );
    expect(newYork.status).toBe(201);
    const moved = await owner.patch(
      `/api/organization/resources/${ids.other}`,
      { timeZone: 'Europe/Bratislava' },
    );
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe('RESOURCE_BUSY');
    expect(moved.body.conflict.slotId).toBe(bratislava.body.id);
    expect(moved.body.conflict.resourceId).toBe(ids.anna);
    const hall = await owner.get(`/api/organization/resources/${ids.other}`);
    expect(hall.body.timeZone).toBe('America/New_York');
    const slot = await owner.get(
      `/api/organization/schedule-slots/${newYork.body.id}`,
    );
    expect(slot.body.startTime).toBe('18:00');
  });

  it('defaults hidden audience and format, and rejects a virtual offline slot', async () => {
    const yoga = await createStudio('Yoga Form');
    const owner = authed(await sessionFor(yoga, OWNER));
    const ids = await catalog(owner);
    const hidden = await owner.patch('/api/organization/settings', {
      scheduleConfig: {
        audienceEnabled: false,
        formatEnabled: false,
        statuses: ['planned', 'cancelled'],
      },
    });
    expect(hidden.status).toBe(200);
    const plain = await owner.post('/api/organization/schedule-slots', {
      kind: 'service',
      placeResourceId: ids.hall,
      date: DAY,
      startTime: '10:00',
      durationMinutes: 60,
      resourceIds: [ids.yoga, ids.anna],
    });
    expect(plain.status).toBe(201);
    expect(plain.body.audience).toBe('one_person');
    expect(plain.body.format).toBe('offline');
    expect(plain.body.places).toBeNull();
    const online = await owner.post('/api/organization/schedule-slots', {
      kind: 'service',
      placeResourceId: ids.virtual,
      date: DAY,
      startTime: '11:00',
      durationMinutes: 60,
      resourceIds: [ids.yoga, ids.boris],
    });
    expect(online.status).toBe(201);
    expect(online.body.format).toBe('online_only');

    await owner.patch('/api/organization/settings', {
      scheduleConfig: {
        audienceEnabled: true,
        formatEnabled: true,
        statuses: ['planned', 'cancelled'],
      },
    });
    const virtualFormat = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, {
        placeResourceId: ids.virtual,
        format: 'offline',
        places: null,
        startTime: '12:00',
        resourceIds: [ids.yoga, ids.anna],
      }),
    );
    expect(virtualFormat.status).toBe(400);
    const missingPlaces = await owner.post(
      '/api/organization/schedule-slots',
      body(ids, { places: null, startTime: '13:00' }),
    );
    expect(missingPlaces.status).toBe(400);
  });
});
