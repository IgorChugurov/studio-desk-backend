import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

const OWNER = 'owner@example.com';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('studio trainers and class types', () => {
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
    const rows = await sql<{ id: string }>(
      `insert into studio (name, subdomain, owner_email) values ($1, $2, $3) returning id`,
      [name, name.toLowerCase(), OWNER],
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

  it('keeps trainers and class types, and serves their files in public', async () => {
    const yoga = await createStudio('Yoga');
    const other = await createStudio('Other');
    const token = await sessionFor(yoga, OWNER);
    const outsider = await sessionFor(other, OWNER);
    await sql(
      `insert into studio_staff (studio_id, email, role) values ($1, $2, 'accountant')`,
      [yoga, 'books@example.com'],
    );
    const accountant = await sessionFor(yoga, 'books@example.com');

    const created = await http()
      .post('/api/studio/trainers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Anna',
        description: '  ',
        instagram: 'https://instagram.com/anna',
        tiktok: '',
      });
    expect(created.status).toBe(201);
    expect(created.body.description).toBeNull();
    expect(created.body.instagram).toBe('https://instagram.com/anna');
    expect(created.body.tiktok).toBeNull();

    const sameName = await http()
      .post('/api/studio/trainers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Anna' });
    expect(sameName.status).toBe(201);

    const bad = await http()
      .post('/api/studio/trainers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: ' ', instagram: 'https://example.com/anna' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual([
      expect.objectContaining({ field: 'name', code: 'REQUIRED' }),
      expect.objectContaining({ field: 'instagram', code: 'INVALID_FORMAT' }),
    ]);

    const found = await http()
      .get('/api/studio/trainers?search=ann')
      .set('Authorization', `Bearer ${token}`);
    expect(found.body.items).toHaveLength(2);
    const missed = await http()
      .get('/api/studio/trainers?search=quiet')
      .set('Authorization', `Bearer ${token}`);
    expect(missed.body.items).toEqual([]);

    expect(
      (
        await http()
          .get('/api/studio/trainers')
          .set('Authorization', `Bearer ${accountant}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .get(`/api/studio/trainers/${created.body.id}`)
          .set('Authorization', `Bearer ${outsider}`)
      ).status,
    ).toBe(404);

    const uploaded = await http()
      .post(`/api/studio/trainers/${created.body.id}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, 'a.jpg');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.images[0].index).toBe(0);
    expect(uploaded.body.images[0].url).toBe(
      `/files/trainers/${created.body.id}/${uploaded.body.images[0].id}.jpg`,
    );
    const open = await http().get(uploaded.body.images[0].url).buffer(true);
    expect(open.status).toBe(200);

    const renamed = await http()
      .patch(`/api/studio/trainers/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Anna K' });
    expect(renamed.body.images[0].index).toBe(0);

    const classType = await http()
      .post('/api/studio/class-types')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Yoga', description: '' });
    expect(classType.status).toBe(201);
    expect(classType.body.description).toBeNull();
    const classFile = await http()
      .post(`/api/studio/class-types/${classType.body.id}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpeg, 'a.jpg');
    expect(classFile.body.images[0].url).toContain('/files/class-types/');
  });
});
