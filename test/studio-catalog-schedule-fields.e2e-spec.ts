import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';
import { INSERT_ORGANIZATION } from './support/insert-organization.js';

const OWNER = 'owner@example.com';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('catalog schedule fields', () => {
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
    const subdomain = name.toLowerCase().replace(/\s+/g, '-');
    const rows = await sql<{ id: string }>(INSERT_ORGANIZATION, [
      name,
      subdomain,
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
      post: (path: string, body: Record<string, unknown>) =>
        http().post(path).set('Authorization', `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown>) =>
        http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
    };
  }

  it('defaults a hall to ordinary in the studio time zone, and validates the zone', async () => {
    const yoga = await createStudio('Yoga Zone');
    const owner = authed(await sessionFor(yoga, OWNER));

    const created = await owner.post('/api/organization/halls', {
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    expect(created.status).toBe(201);
    expect(created.body.type).toBe('ordinary');
    expect(created.body.timeZone).toBe('Europe/Bratislava');

    const withZone = await owner.post('/api/organization/halls', {
      name: 'Second hall',
      address: 'Hlavná 2',
      timeZone: 'America/New_York',
    });
    expect(withZone.status).toBe(201);
    expect(withZone.body.timeZone).toBe('America/New_York');

    const unknown = await owner.post('/api/organization/halls', {
      name: 'Third hall',
      address: 'Hlavná 3',
      timeZone: 'Mars/Phobos',
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors).toEqual([
      expect.objectContaining({ field: 'timeZone', code: 'INVALID_VALUE' }),
    ]);
  });

  it('lets the hall type change and fixes a virtual hall address', async () => {
    const yoga = await createStudio('Yoga Type');
    const owner = authed(await sessionFor(yoga, OWNER));

    const virtual = await owner.post('/api/organization/halls', {
      type: 'virtual',
      name: 'Online hall',
      address: 'ignored street',
    });
    expect(virtual.status).toBe(201);
    expect(virtual.body.type).toBe('virtual');
    expect(virtual.body.address).toBe('Virtual hall');

    const missingAddress = await owner.patch(
      `/api/organization/halls/${virtual.body.id}`,
      { type: 'ordinary' },
    );
    expect(missingAddress.status).toBe(400);
    expect(missingAddress.body.errors).toEqual([
      expect.objectContaining({ field: 'address', code: 'REQUIRED' }),
    ]);
    const stillVirtual = await owner.get(
      `/api/organization/halls/${virtual.body.id}`,
    );
    expect(stillVirtual.body.type).toBe('virtual');

    const toOrdinary = await owner.patch(
      `/api/organization/halls/${virtual.body.id}`,
      { type: 'ordinary', address: 'Hlavná 4' },
    );
    expect(toOrdinary.status).toBe(200);
    expect(toOrdinary.body.type).toBe('ordinary');
    expect(toOrdinary.body.address).toBe('Hlavná 4');

    const toVirtual = await owner.patch(
      `/api/organization/halls/${virtual.body.id}`,
      { type: 'virtual', address: 'keep this street' },
    );
    expect(toVirtual.status).toBe(200);
    expect(toVirtual.body.type).toBe('virtual');
    expect(toVirtual.body.address).toBe('Virtual hall');

    const changeAddress = await owner.patch(
      `/api/organization/halls/${virtual.body.id}`,
      { address: 'A real street' },
    );
    expect(changeAddress.status).toBe(400);
    expect(changeAddress.body.errors).toEqual([
      expect.objectContaining({ field: 'address', code: 'INVALID_VALUE' }),
    ]);

    const sameType = await owner.patch(
      `/api/organization/halls/${virtual.body.id}`,
      {
        type: 'virtual',
        description: 'Streamed',
      },
    );
    expect(sameType.status).toBe(200);
    expect(sameType.body.address).toBe('Virtual hall');

    const ordinary = await owner.post('/api/organization/halls', {
      name: 'Room',
      address: 'Hlavná 9',
    });
    const blankAddress = await owner.patch(
      `/api/organization/halls/${ordinary.body.id}`,
      { address: '  ' },
    );
    expect(blankAddress.status).toBe(400);
    expect(blankAddress.body.errors).toEqual([
      expect.objectContaining({ field: 'address', code: 'REQUIRED' }),
    ]);

    const movedZone = await owner.patch(
      `/api/organization/halls/${ordinary.body.id}`,
      { timeZone: 'America/New_York' },
    );
    expect(movedZone.status).toBe(200);
    expect(movedZone.body.timeZone).toBe('America/New_York');
  });

  it('refuses an ordinary hall without an address', async () => {
    const yoga = await createStudio('Yoga Addr');
    const owner = authed(await sessionFor(yoga, OWNER));
    const res = await owner.post('/api/organization/halls', {
      name: 'No address',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'address', code: 'REQUIRED' }),
    ]);
  });

  it('requires a valid class-type duration in steps of five', async () => {
    const yoga = await createStudio('Yoga Duration');
    const owner = authed(await sessionFor(yoga, OWNER));

    const missing = await owner.post('/api/organization/class-types', {
      name: 'Pilates',
    });
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([
      expect.objectContaining({ field: 'defaultDuration' }),
    ]);
    expect(missing.body.errors[0].message).toBe(
      'Enter a duration from 5 to 240 minutes in steps of 5',
    );

    for (const bad of [0, 4, 7, 241]) {
      const res = await owner.post('/api/organization/class-types', {
        name: `Bad ${bad}`,
        defaultDuration: bad,
      });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({
          field: 'defaultDuration',
          code: 'INVALID_VALUE',
        }),
      ]);
    }

    for (const good of [5, 60, 240]) {
      const res = await owner.post('/api/organization/class-types', {
        name: `Good ${good}`,
        defaultDuration: good,
      });
      expect(res.status).toBe(201);
      expect(res.body.defaultDuration).toBe(good);
    }
  });

  it('links a trainer and a class type from both cards and allows an empty list', async () => {
    const yoga = await createStudio('Yoga Link');
    const owner = authed(await sessionFor(yoga, OWNER));

    const trainer = await owner.post('/api/organization/trainers', {
      name: 'Anna',
    });
    const yogaType = await owner.post('/api/organization/class-types', {
      name: 'Yoga',
      defaultDuration: 60,
    });
    const pilatesType = await owner.post('/api/organization/class-types', {
      name: 'Pilates',
      defaultDuration: 55,
    });

    // Set from the trainer card.
    const linked = await owner.patch(
      `/api/organization/trainers/${trainer.body.id}`,
      { classTypeIds: [yogaType.body.id] },
    );
    expect(linked.status).toBe(200);
    expect(linked.body.classTypeIds).toEqual([yogaType.body.id]);

    // The class type sees the same link.
    const seenFromType = await owner.get(
      `/api/organization/class-types/${yogaType.body.id}`,
    );
    expect(seenFromType.body.trainerIds).toEqual([trainer.body.id]);

    // Set from the class-type card: replaces the trainer's links for that type.
    const fromType = await owner.patch(
      `/api/organization/class-types/${pilatesType.body.id}`,
      { trainerIds: [trainer.body.id] },
    );
    expect(fromType.status).toBe(200);
    expect(fromType.body.trainerIds).toEqual([trainer.body.id]);

    const trainerNow = await owner.get(
      `/api/organization/trainers/${trainer.body.id}`,
    );
    const byText = (a: string, b: string) => a.localeCompare(b);
    expect([...trainerNow.body.classTypeIds].sort(byText)).toEqual(
      [yogaType.body.id, pilatesType.body.id].sort(byText),
    );

    // Empty list clears it.
    const cleared = await owner.patch(
      `/api/organization/trainers/${trainer.body.id}`,
      { classTypeIds: [] },
    );
    expect(cleared.body.classTypeIds).toEqual([]);
    const yogaAfter = await owner.get(
      `/api/organization/class-types/${yogaType.body.id}`,
    );
    expect(yogaAfter.body.trainerIds).toEqual([]);
  });

  it('refuses a link to another studio and keeps file indexes on save', async () => {
    const yoga = await createStudio('Yoga Own');
    const other = await createStudio('Other Own');
    const owner = authed(await sessionFor(yoga, OWNER));
    const stranger = authed(await sessionFor(other, OWNER));

    const trainer = await owner.post('/api/organization/trainers', {
      name: 'Anna',
    });
    const classType = await owner.post('/api/organization/class-types', {
      name: 'Yoga',
      defaultDuration: 60,
    });
    const otherType = await stranger.post('/api/organization/class-types', {
      name: 'Boxing',
      defaultDuration: 60,
    });
    const otherTrainer = await stranger.post('/api/organization/trainers', {
      name: 'Bob',
    });

    const badOnTrainer = await owner.patch(
      `/api/organization/trainers/${trainer.body.id}`,
      { classTypeIds: [otherType.body.id] },
    );
    expect(badOnTrainer.status).toBe(400);
    expect(badOnTrainer.body.errors).toEqual([
      expect.objectContaining({
        field: 'classTypeIds',
        code: 'INVALID_VALUE',
      }),
    ]);

    const badOnType = await owner.patch(
      `/api/organization/class-types/${classType.body.id}`,
      { trainerIds: [otherTrainer.body.id] },
    );
    expect(badOnType.status).toBe(400);
    expect(badOnType.body.errors).toEqual([
      expect.objectContaining({ field: 'trainerIds', code: 'INVALID_VALUE' }),
    ]);

    // Saving the link does not change file indexes.
    const uploaded = await http()
      .post(`/api/organization/trainers/${trainer.body.id}/files`)
      .set('Authorization', `Bearer ${await sessionFor(yoga, OWNER)}`)
      .attach('files', jpeg, 'a.jpg')
      .attach('files', jpeg, 'b.jpg');
    expect(uploaded.body.images.map((f: { index: number }) => f.index)).toEqual(
      [0, 1],
    );
    const saved = await owner.patch(
      `/api/organization/trainers/${trainer.body.id}`,
      {
        classTypeIds: [classType.body.id],
      },
    );
    expect(saved.body.images.map((f: { index: number }) => f.index)).toEqual([
      0, 1,
    ]);
  });

  it('refuses an accountant and lets an administrator through on the new fields', async () => {
    const yoga = await createStudio('Yoga Roles');
    const owner = authed(await sessionFor(yoga, OWNER));
    const classType = await owner.post('/api/organization/class-types', {
      name: 'Yoga',
      defaultDuration: 60,
    });

    await sql(
      `insert into organization_staff (organization_id, email, role) values ($1, $2, 'accountant'), ($1, $3, 'administrator')`,
      [yoga, 'books@example.com', 'admin@example.com'],
    );
    const accountant = authed(await sessionFor(yoga, 'books@example.com'));
    const admin = authed(await sessionFor(yoga, 'admin@example.com'));

    expect(
      (
        await accountant.post('/api/organization/class-types', {
          name: 'Hidden',
          defaultDuration: 60,
        })
      ).status,
    ).toBe(403);
    const updated = await admin.patch(
      `/api/organization/class-types/${classType.body.id}`,
      { defaultDuration: 90 },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.defaultDuration).toBe(90);
  });
});
