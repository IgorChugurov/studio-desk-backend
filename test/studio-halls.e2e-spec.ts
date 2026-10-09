import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

const OWNER = 'owner@example.com';

describe('studio halls', () => {
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

  async function staff(studioId: string, email: string, role: string) {
    await sql(
      `insert into studio_staff (studio_id, email, role) values ($1, $2, $3)`,
      [studioId, email, role],
    );
    return sessionFor(studioId, email);
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

  it('creates, lists, reads, and updates a hall, and keeps an empty video link empty', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));

    const created = await owner.post('/api/studio/halls', {
      name: '  Main hall  ',
      address: ' Hlavná 1 ',
      videoLink: '  ',
      files: [{ name: 'room.jpg' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Main hall');
    expect(created.body.address).toBe('Hlavná 1');
    expect(created.body.videoLink).toBeNull();
    expect(created.body.images).toEqual([]);

    const stored = await sql<{ count: number }>(
      `select count(*)::int as count from hall_file where hall_id = $1`,
      [created.body.id],
    );
    expect(stored[0]!.count).toBe(0);

    const sameName = await owner.post('/api/studio/halls', {
      name: 'Main hall',
      address: 'Other street',
    });
    expect(sameName.status).toBe(201);

    const list = await owner.get('/api/studio/halls?search=MAIN');
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: { name: string }) => item.name)).toEqual([
      'Main hall',
      'Main hall',
    ]);
    expect(list.body.items[0].images).toEqual([]);

    const read = await owner.get(`/api/studio/halls/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.address).toBe('Hlavná 1');

    const updated = await owner.patch(`/api/studio/halls/${created.body.id}`, {
      videoLink: 'https://youtu.be/abc',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Main hall');
    expect(updated.body.videoLink).toBe('https://youtu.be/abc');

    const cleared = await owner.patch(`/api/studio/halls/${created.body.id}`, {
      videoLink: '',
    });
    expect(cleared.body.videoLink).toBeNull();
  });

  it('returns images sorted by index and does not change them when the name changes', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const created = await owner.post('/api/studio/halls', {
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    const hallId = created.body.id as string;
    await sql(
      `insert into hall_file (hall_id, storage_path, content_type, index)
       values ($1, $2, 'image/jpeg', 0), ($1, $3, 'video/mp4', 1)`,
      [hallId, `/files/halls/${hallId}/a.jpg`, `/files/halls/${hallId}/b.mp4`],
    );

    const read = await owner.get(`/api/studio/halls/${created.body.id}`);
    expect(
      read.body.images.map((file: { index: number; kind: string }) => ({
        index: file.index,
        kind: file.kind,
      })),
    ).toEqual([
      { index: 0, kind: 'image' },
      { index: 1, kind: 'video' },
    ]);
    expect(read.body.images[0].url).toBe(`/files/halls/${hallId}/a.jpg`);

    const updated = await owner.patch(`/api/studio/halls/${created.body.id}`, {
      name: 'Renamed',
    });
    expect(
      updated.body.images.map((file: { index: number }) => file.index),
    ).toEqual([0, 1]);
  });

  it('refuses an empty name, an empty address, and a link that is not YouTube or Vimeo', async () => {
    const yoga = await createStudio('Yoga');
    const owner = authed(await sessionFor(yoga, OWNER));
    const res = await owner.post('/api/studio/halls', {
      name: ' ',
      address: '',
      videoLink: 'https://example.com/video',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'name', code: 'REQUIRED' }),
      expect.objectContaining({ field: 'address', code: 'REQUIRED' }),
      expect.objectContaining({ field: 'videoLink', code: 'INVALID_FORMAT' }),
    ]);
  });

  it('refuses an accountant and a hall of another studio, and lets an administrator through', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const owner = authed(await sessionFor(yoga, OWNER));
    const created = await owner.post('/api/studio/halls', {
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    const accountant = authed(
      await staff(yoga, 'books@example.com', 'accountant'),
    );
    const admin = authed(
      await staff(yoga, 'admin@example.com', 'administrator'),
    );
    const outsider = authed(await sessionFor(other, OWNER));

    expect((await accountant.get('/api/studio/halls')).status).toBe(403);
    expect(
      (
        await accountant.post('/api/studio/halls', {
          name: 'Hidden',
          address: 'Street',
        })
      ).status,
    ).toBe(403);
    expect(
      (await outsider.get(`/api/studio/halls/${created.body.id}`)).status,
    ).toBe(404);
    expect(
      (
        await outsider.patch(`/api/studio/halls/${created.body.id}`, {
          name: 'Stolen',
        })
      ).status,
    ).toBe(404);

    const allowed = await admin.get('/api/studio/halls');
    expect(allowed.status).toBe(200);
    expect(allowed.body.items).toHaveLength(1);

    const closed = await http().get('/api/studio/halls');
    expect(closed.status).toBe(401);
  });

  it('uploads, reindexes, reorders, and serves file bytes', async () => {
    const yoga = await createStudio('Yoga');
    const token = await sessionFor(yoga, OWNER);
    const created = await authed(token).post('/api/studio/halls', {
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    const hallId = created.body.id as string;

    const uploaded = await http()
      .post(`/api/studio/halls/${hallId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, { filename: 'a.jpg', contentType: 'text/plain' })
      .attach('files', png, { filename: 'b.png', contentType: 'image/png' })
      .attach('files', webm, { filename: 'c.webm', contentType: 'video/webm' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.images[0].url).toBe(
      `/files/halls/${hallId}/${uploaded.body.images[0].id}.jpg`,
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

    const again = await http()
      .post(`/api/studio/halls/${hallId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', gif, { filename: 'd.gif', contentType: 'image/gif' });
    expect(
      again.body.images.map((file: { index: number }) => file.index),
    ).toEqual([0, 1, 2, 3]);

    const middle = uploaded.body.images[1].id as string;
    const removed = await http()
      .delete(`/api/studio/halls/${hallId}/files/${middle}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(
      removed.body.images.map((file: { index: number }) => file.index),
    ).toEqual([0, 1, 2]);

    const ids = removed.body.images.map(
      (file: { id: string }) => file.id,
    ) as string[];
    const reordered = await http()
      .put(`/api/studio/halls/${hallId}/files/order`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileIds: [ids[2], ids[0], ids[1]] });
    expect(reordered.status).toBe(200);
    expect(
      reordered.body.images.map((file: { id: string }) => file.id),
    ).toEqual([ids[2], ids[0], ids[1]]);

    const renamed = await authed(token).patch(`/api/studio/halls/${hallId}`, {
      name: 'Renamed',
    });
    expect(
      renamed.body.images.map((file: { index: number }) => file.index),
    ).toEqual([0, 1, 2]);

    const jpegUrl = renamed.body.images.find(
      (file: { id: string }) => file.id === ids[0],
    ).url as string;
    const bytes = await http().get(jpegUrl).buffer(true);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(bytes.body).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  });

  it('stores nothing when one file in the upload is rejected', async () => {
    const yoga = await createStudio('Yoga');
    const token = await sessionFor(yoga, OWNER);
    const created = await authed(token).post('/api/studio/halls', {
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    const hallId = created.body.id as string;
    const rejected = await http()
      .post(`/api/studio/halls/${hallId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, 'a.jpg')
      .attach('files', Buffer.from('hello'), 'note.txt');
    expect(rejected.status).toBe(400);
    expect(rejected.body.errors).toEqual([
      expect.objectContaining({ field: 'files', code: 'INVALID_VALUE' }),
    ]);
    const stored = await sql<{ count: number }>(
      `select count(*)::int as count from hall_file where hall_id = $1`,
      [hallId],
    );
    expect(stored[0]!.count).toBe(0);

    const empty = await http()
      .post(`/api/studio/halls/${hallId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.alloc(0), 'empty.jpg');
    expect(empty.status).toBe(400);
    expect(empty.body.errors[0].code).toBe('TOO_SMALL');
  });

  it('serves a hall file without a session and refuses a change from another studio', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const token = await sessionFor(yoga, OWNER);
    const created = await authed(token).post('/api/studio/halls', {
      name: 'Main hall',
      address: 'Hlavná 1',
    });
    const uploaded = await http()
      .post(`/api/studio/halls/${created.body.id}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, 'a.jpg');
    const file = uploaded.body.images[0] as { id: string; url: string };
    const outsider = await sessionFor(other, OWNER);

    const open = await http().get(file.url).buffer(true);
    expect(open.status).toBe(200);
    expect(
      (
        await http()
          .delete(`/api/studio/halls/${created.body.id}/files/${file.id}`)
          .set('Authorization', `Bearer ${outsider}`)
      ).status,
    ).toBe(404);
  });
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const gif = Buffer.from('GIF89a');
const webm = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('webm'),
]);
