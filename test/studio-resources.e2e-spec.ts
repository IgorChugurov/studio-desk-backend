import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';
import { INSERT_ORGANIZATION } from './support/insert-organization.js';

const OWNER = 'owner@example.com';

describe('unified catalog resources', () => {
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
    const rows = await sql<{ id: string }>(INSERT_ORGANIZATION, [
      name,
      subdomain,
      owner,
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

  async function staff(organizationId: string, email: string, role: string) {
    await sql(
      `insert into organization_staff (organization_id, email, role) values ($1, $2, $3)`,
      [organizationId, email, role],
    );
    return sessionFor(organizationId, email);
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

  async function typeIds(owner: ReturnType<typeof authed>) {
    const settings = await owner.get('/api/organization/settings');
    const types = settings.body.catalogConfig.resourceTypes as Array<{
      id: string;
      role: string;
    }>;
    return {
      place: types.find((type) => type.role === 'place')!.id,
      resource: types.find((type) => type.role === 'resource')!.id,
      offering: types.find((type) => type.role === 'offering')!.id,
    };
  }

  it('creates a place, stores Virtual place, and ignores disabled cubes', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const types = await typeIds(owner);

    const missing = await owner.post('/api/organization/resources', {
      resourceTypeId: types.place,
      type: 'ordinary',
    });
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'name',
          code: 'REQUIRED',
          message: 'Enter a name',
        }),
        expect.objectContaining({
          field: 'address',
          code: 'REQUIRED',
          message: 'Enter an address',
        }),
      ]),
    );

    const created = await owner.post('/api/organization/resources', {
      resourceTypeId: types.place,
      name: '  Main hall  ',
      address: ' Hlavná 1 ',
      defaultDuration: 15,
      relatedResourceIds: ['not-used'],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      resourceTypeId: types.place,
      name: 'Main hall',
      type: 'ordinary',
      address: 'Hlavná 1',
      timeZone: 'Europe/Bratislava',
      defaultDuration: null,
      description: null,
      relatedResourceIds: [],
      images: [],
    });

    const virtual = await owner.post('/api/organization/resources', {
      resourceTypeId: types.place,
      type: 'virtual',
      name: 'Online',
      address: 'ignored',
    });
    expect(virtual.status).toBe(201);
    expect(virtual.body.address).toBe('Virtual place');

    const badZone = await owner.post('/api/organization/resources', {
      resourceTypeId: types.place,
      name: 'Elsewhere',
      address: 'Street 2',
      timeZone: 'Not/AZone',
    });
    expect(badZone.status).toBe(400);
    expect(badZone.body.errors[0]).toMatchObject({
      field: 'timeZone',
      code: 'INVALID_VALUE',
    });

    const toOrdinary = await owner.patch(
      `/api/organization/resources/${virtual.body.id}`,
      { type: 'ordinary' },
    );
    expect(toOrdinary.status).toBe(400);
    expect(toOrdinary.body.errors[0]).toMatchObject({
      field: 'address',
      code: 'REQUIRED',
      message: 'Enter an address',
    });
    const ordinary = await owner.patch(
      `/api/organization/resources/${virtual.body.id}`,
      { type: 'ordinary', address: 'New street' },
    );
    expect(ordinary.body).toMatchObject({
      type: 'ordinary',
      address: 'New street',
    });
    const back = await owner.patch(
      `/api/organization/resources/${virtual.body.id}`,
      { type: 'virtual' },
    );
    expect(back.body.address).toBe('Virtual place');

    const list = await owner.get(
      `/api/organization/resources?resourceTypeId=${types.place}&search=MAIN`,
    );
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].name).toBe('Main hall');
  });

  it('validates offering duration and keeps geography empty', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const types = await typeIds(owner);
    const missing = await owner.post('/api/organization/resources', {
      resourceTypeId: types.offering,
      name: 'Yoga',
    });
    expect(missing.status).toBe(400);
    expect(missing.body.errors[0]).toMatchObject({
      field: 'defaultDuration',
      code: 'REQUIRED',
      message: 'Enter a duration from 5 to 1440 minutes in steps of 5',
    });
    for (const defaultDuration of [4, 7, 1445]) {
      const rejected = await owner.post('/api/organization/resources', {
        resourceTypeId: types.offering,
        name: 'Yoga',
        defaultDuration,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.errors[0].field).toBe('defaultDuration');
    }
    const created = await owner.post('/api/organization/resources', {
      resourceTypeId: types.offering,
      name: 'Yoga',
      defaultDuration: 1440,
      address: 'should be ignored',
      type: 'ordinary',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      resourceTypeId: types.offering,
      defaultDuration: 1440,
      type: null,
      address: null,
      timeZone: null,
    });
    const shortest = await owner.post('/api/organization/resources', {
      resourceTypeId: types.offering,
      name: 'Short',
      defaultDuration: 5,
    });
    expect(shortest.status).toBe(201);
    expect(shortest.body.defaultDuration).toBe(5);
  });

  it('links skills resources symmetrically and rejects a same-type or foreign id', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const owner = authed(await sessionFor(yoga, OWNER));
    const stranger = authed(await sessionFor(other, OWNER));
    const types = await typeIds(owner);
    const otherTypes = await typeIds(stranger);
    const trainer = await owner.post('/api/organization/resources', {
      resourceTypeId: types.resource,
      name: 'Anna',
      instagram: 'https://instagram.com/anna',
      tiktok: '',
      videoLink: 'https://www.youtube.com/watch?v=abc',
    });
    expect(trainer.status).toBe(201);
    expect(trainer.body).toMatchObject({
      instagram: 'https://instagram.com/anna',
      tiktok: null,
      videoLink: 'https://www.youtube.com/watch?v=abc',
      type: null,
      defaultDuration: null,
    });
    const badLink = await owner.post('/api/organization/resources', {
      resourceTypeId: types.resource,
      name: 'Boris',
      instagram: 'https://example.com/anna',
    });
    expect(badLink.status).toBe(400);
    expect(badLink.body.errors[0]).toMatchObject({
      field: 'instagram',
      code: 'INVALID_FORMAT',
      message: 'Enter an Instagram link',
    });

    const yogaType = await owner.post('/api/organization/resources', {
      resourceTypeId: types.offering,
      name: 'Yoga',
      defaultDuration: 60,
      relatedResourceIds: [trainer.body.id],
    });
    expect(yogaType.status).toBe(201);
    expect(yogaType.body.relatedResourceIds).toEqual([trainer.body.id]);
    const seen = await owner.get(
      `/api/organization/resources/${trainer.body.id}`,
    );
    expect(seen.body.relatedResourceIds).toEqual([yogaType.body.id]);

    const cleared = await owner.patch(
      `/api/organization/resources/${yogaType.body.id}`,
      { relatedResourceIds: [] },
    );
    expect(cleared.body.relatedResourceIds).toEqual([]);
    const trainerNow = await owner.get(
      `/api/organization/resources/${trainer.body.id}`,
    );
    expect(trainerNow.body.relatedResourceIds).toEqual([]);

    const peer = await owner.post('/api/organization/resources', {
      resourceTypeId: types.resource,
      name: 'Boris',
    });
    const sameType = await owner.patch(
      `/api/organization/resources/${trainer.body.id}`,
      { relatedResourceIds: [peer.body.id] },
    );
    expect(sameType.status).toBe(400);
    expect(sameType.body.errors[0].field).toBe('relatedResourceIds');

    const foreign = await stranger.post('/api/organization/resources', {
      resourceTypeId: otherTypes.offering,
      name: 'Pilates',
      defaultDuration: 60,
    });
    const otherOrg = await owner.patch(
      `/api/organization/resources/${trainer.body.id}`,
      { relatedResourceIds: [foreign.body.id] },
    );
    expect(otherOrg.status).toBe(400);
    expect(otherOrg.body.errors[0].field).toBe('relatedResourceIds');
  });

  it('keeps the catalogs section closed for an accountant and a specialist', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const types = await typeIds(owner);
    const created = await owner.post('/api/organization/resources', {
      resourceTypeId: types.place,
      name: 'Main',
      address: 'Street 1',
    });
    const accountant = authed(
      await staff(yoga, 'books@example.com', 'accountant'),
    );
    const specialist = authed(
      await staff(yoga, 'anna@example.com', 'specialist'),
    );
    expect((await accountant.get('/api/organization/resources')).status).toBe(
      403,
    );
    expect((await specialist.get('/api/organization/resources')).status).toBe(
      403,
    );
    const admin = authed(
      await staff(yoga, 'admin@example.com', 'administrator'),
    );
    expect((await admin.get('/api/organization/resources')).status).toBe(200);
    expect((await http().get('/api/organization/resources')).status).toBe(401);
    const outsider = authed(
      await sessionFor(await createStudio('Other'), OWNER),
    );
    expect(
      (await outsider.get(`/api/organization/resources/${created.body.id}`))
        .status,
    ).toBe(404);
  });

  it('uploads, reindexes, and serves files at /files/resources', async () => {
    const yoga = await createStudio('Yoga');
    const token = await sessionFor(yoga, OWNER);
    const owner = authed(token);
    const types = await typeIds(owner);
    const created = await owner.post('/api/organization/resources', {
      resourceTypeId: types.place,
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    const resourceId = created.body.id as string;
    const uploaded = await http()
      .post(`/api/organization/resources/${resourceId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, { filename: 'a.jpg', contentType: 'text/plain' })
      .attach('files', png, { filename: 'b.png', contentType: 'image/png' })
      .attach('files', webm, { filename: 'c.webm', contentType: 'video/webm' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.images[0].url).toBe(
      `/files/resources/${resourceId}/${uploaded.body.images[0].id}.jpg`,
    );
    expect(
      uploaded.body.images.map((file: { index: number; kind: string }) => ({
        index: file.index,
        kind: file.kind,
      })),
    ).toEqual([
      { index: 0, kind: 'image' },
      { index: 1, kind: 'image' },
      { index: 2, kind: 'video' },
    ]);

    const middle = uploaded.body.images[1].id as string;
    const removed = await http()
      .delete(`/api/organization/resources/${resourceId}/files/${middle}`)
      .set('Authorization', `Bearer ${token}`);
    expect(
      removed.body.images.map((file: { index: number }) => file.index),
    ).toEqual([0, 1]);
    const ids = removed.body.images.map(
      (file: { id: string }) => file.id,
    ) as string[];
    const reordered = await http()
      .put(`/api/organization/resources/${resourceId}/files/order`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileIds: [ids[1], ids[0]] });
    expect(
      reordered.body.images.map((file: { id: string }) => file.id),
    ).toEqual([ids[1], ids[0]]);

    const renamed = await owner.patch(
      `/api/organization/resources/${resourceId}`,
      { name: 'Renamed' },
    );
    expect(
      renamed.body.images.map((file: { index: number }) => file.index),
    ).toEqual([0, 1]);
    const bytes = await http().get(renamed.body.images[1].url).buffer(true);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toBe('image/jpeg');

    const rejected = await http()
      .post(`/api/organization/resources/${resourceId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, 'a.jpg')
      .attach('files', Buffer.from('hello'), 'note.txt');
    expect(rejected.status).toBe(400);
    const stored = await sql<{ count: number }>(
      `select count(*)::int as count from resource_file where resource_id = $1`,
      [resourceId],
    );
    expect(stored[0]!.count).toBe(2);
  });
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webm = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('webm'),
]);
