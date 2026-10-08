import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

describe('interface language', () => {
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

  async function tokenFor(name: string, email: string) {
    const studio = await sql<{ id: string }>(
      `insert into studio (name, subdomain, owner_email) values ($1, $2, $3) returning id`,
      [name, name.toLowerCase(), email],
    );
    const session = await sql<{ id: string }>(
      `insert into studio_session (studio_id, email, expires_at, refresh_token_hash)
       values ($1, $2, now() + interval '1 day', gen_random_uuid()::text)
       returning id`,
      [studio[0]!.id, email],
    );
    return signAccessToken(
      {
        sub: email,
        sid: session[0]!.id,
        api: 'studio',
        studioId: studio[0]!.id,
      },
      loadEnv().ACCESS_TOKEN_SECRET,
    );
  }

  function authed(token: string) {
    return {
      get: () =>
        http().get('/api/studio/me').set('Authorization', `Bearer ${token}`),
      patch: (body: Record<string, unknown>) =>
        http()
          .patch('/api/studio/me/language')
          .set('Authorization', `Bearer ${token}`)
          .send(body),
    };
  }

  it('keeps one language per e-mail across studios, and none means English', async () => {
    const anna = authed(await tokenFor('Yoga', 'anna@example.com'));
    const annaAgain = authed(await tokenFor('Pilates', 'anna@example.com'));
    const olga = authed(await tokenFor('Other', 'olga@example.com'));

    expect((await anna.get()).body.user.interfaceLanguage).toBeNull();

    const saved = await anna.patch({ language: ' uk ' });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ interfaceLanguage: 'uk' });
    expect((await anna.get()).body.user.interfaceLanguage).toBe('uk');
    expect((await annaAgain.get()).body.user.interfaceLanguage).toBe('uk');
    expect((await olga.get()).body.user.interfaceLanguage).toBeNull();

    const changed = await anna.patch({ language: 'sk' });
    expect(changed.body.interfaceLanguage).toBe('sk');
    expect((await annaAgain.get()).body.user.interfaceLanguage).toBe('sk');
  });

  it('rejects an empty or unknown language', async () => {
    const anna = authed(await tokenFor('Yoga', 'anna@example.com'));
    const blank = await anna.patch({ language: '  ' });
    expect(blank.status).toBe(400);
    expect(blank.body.errors).toEqual([
      expect.objectContaining({ code: 'REQUIRED', field: 'language' }),
    ]);
    const unknown = await anna.patch({ language: 'de' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors).toEqual([
      expect.objectContaining({ code: 'INVALID_VALUE', field: 'language' }),
    ]);
    expect((await anna.get()).body.user.interfaceLanguage).toBeNull();
  });
});
