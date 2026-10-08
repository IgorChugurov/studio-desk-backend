import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MAILER, type Mailer } from '../src/common/auth/mailer.js';
import { ensurePlatformAdministrator } from '../src/database/ensure-platform-administrator.js';
import { createTestApp } from './support/app.js';
import { fixtureImports } from './support/fixtures.js';
import { ownerPool } from './support/db.js';

const ADMIN = 'admin@example.com';
const OTHER = 'nobody@example.com';

describe('platform sign-in', () => {
  let app: INestApplication;
  const sent: { email: string; code: string }[] = [];
  const mailer: Mailer = {
    sendSignInCode: (email, code) => {
      sent.push({ email, code });
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createTestApp({
      imports: fixtureImports,
      override: (builder) => builder.overrideProvider(MAILER).useValue(mailer),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    const pool = ownerPool();
    await pool.query('insert into platform_administrator (email) values ($1)', [
      ADMIN,
    ]);
    await pool.end();
  });

  function latestCode() {
    const item = sent.at(-1);
    if (!item) throw new Error('code was not sent');
    return item.code;
  }

  it('answers the same way for a known and an unknown e-mail, and mails only the administrator', async () => {
    const known = await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: 'Admin@Example.com' });
    const unknown = await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: OTHER });

    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(known.body).toEqual({ codeExpiresIn: 600, resendAvailableIn: 60 });
    expect(sent.map((item) => item.email)).toEqual([ADMIN]);
  });

  it('refuses a second code before the wait is over, for any e-mail', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: OTHER });
    const again = await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: OTHER });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('RESEND_TOO_EARLY');
  });

  it('replaces the code after the wait and gives a full set of attempts', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    const pool = ownerPool();
    await pool.query(
      `update sign_in_code
          set created_at = now() - interval '2 minutes',
              attempts_remaining = 1
        where email = $1`,
      [ADMIN],
    );
    await pool.end();
    const again = await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    expect(again.status).toBe(200);
    expect(sent).toHaveLength(2);

    const check = ownerPool();
    const { rows } = await check.query<{ attempts_remaining: number }>(
      'select attempts_remaining from sign_in_code where email = $1',
      [ADMIN],
    );
    await check.end();
    expect(rows[0]?.attempts_remaining).toBe(5);
  });

  it('deletes codes that expired more than an hour ago only when a new code is requested', async () => {
    const pool = ownerPool();
    await pool.query(
      `insert into sign_in_code (email, code_hash, created_at, expires_at, attempts_remaining)
       values ('old@example.com', 'hash', now() - interval '2 hours', now() - interval '2 hours', 5)`,
    );
    await pool.end();

    const signIn = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-in')
      .send({ email: 'old@example.com', code: '000000' });
    expect(signIn.body.code).toBe('CODE_EXPIRED');

    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    const check = ownerPool();
    const { rows } = await check.query(
      `select email from sign_in_code where email = 'old@example.com'`,
    );
    await check.end();
    expect(rows).toEqual([]);
  });

  it('keeps a recently expired code and reports CODE_EXPIRED', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    const pool = ownerPool();
    await pool.query(
      `update sign_in_code
          set expires_at = now() - interval '10 minutes'
        where email = $1`,
      [ADMIN],
    );
    await pool.end();
    const res = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-in')
      .send({ email: ADMIN, code: latestCode() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_EXPIRED');
  });

  it('rejects a wrong code and locks the code after five attempts', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/platform/auth/sign-in')
        .send({ email: ADMIN, code: '000000' });
      expect(res.body.code).toBe('INVALID_CODE');
    }
    const last = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-in')
      .send({ email: ADMIN, code: '000000' });
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('signs in once, then the same code is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    const signed = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-in')
      .send({ email: ADMIN, code: latestCode() });
    expect(signed.status).toBe(200);
    expect(signed.body.user).toEqual({ email: ADMIN });
    expect(signed.body.accessTokenExpiresIn).toBe(900);
    expect(cookie(signed)).toBeTruthy();

    const again = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-in')
      .send({ email: ADMIN, code: latestCode() });
    expect(again.body.code).toBe('INVALID_CODE');
  });

  it('accepts the access token and rejects it after sign-out', async () => {
    const token = await signIn();
    const open = await request(app.getHttpServer())
      .get('/api/platform/fixture/closed')
      .set('Authorization', `Bearer ${token.access}`);
    expect(open.status).toBe(200);

    const signedOut = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-out')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', `${token.cookieName}=${token.refresh}`);
    expect(signedOut.status).toBe(204);

    const closed = await request(app.getHttpServer())
      .get('/api/platform/fixture/closed')
      .set('Authorization', `Bearer ${token.access}`);
    expect(closed.status).toBe(401);
  });

  it('accepts the previous refresh token for a few seconds', async () => {
    const token = await signIn();
    const refreshed = await request(app.getHttpServer())
      .post('/api/platform/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', `${token.cookieName}=${token.refresh}`);
    expect(refreshed.status).toBe(200);

    const withinWindow = await request(app.getHttpServer())
      .post('/api/platform/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', `${token.cookieName}=${token.refresh}`);
    expect(withinWindow.status).toBe(200);
  });

  it('revokes the session when the previous refresh token is presented too late', async () => {
    const token = await signIn();
    const refreshed = await request(app.getHttpServer())
      .post('/api/platform/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', `${token.cookieName}=${token.refresh}`);
    expect(refreshed.status).toBe(200);

    const pool = ownerPool();
    await pool.query(
      `update session set rotated_at = now() - interval '11 seconds'`,
    );
    await pool.end();
    const reused = await request(app.getHttpServer())
      .post('/api/platform/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', `${token.cookieName}=${token.refresh}`);
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('SESSION_EXPIRED');
  });

  it('requires the requested-with header and a cookie on refresh', async () => {
    const missingHeader = await request(app.getHttpServer()).post(
      '/api/platform/auth/refresh',
    );
    expect(missingHeader.status).toBe(403);

    const missingCookie = await request(app.getHttpServer())
      .post('/api/platform/auth/refresh')
      .set('X-Requested-With', 'fetch');
    expect(missingCookie.status).toBe(401);
    expect(missingCookie.body.code).toBe('UNAUTHORIZED');
  });

  async function signIn() {
    await request(app.getHttpServer())
      .post('/api/platform/auth/code')
      .send({ email: ADMIN });
    const signed = await request(app.getHttpServer())
      .post('/api/platform/auth/sign-in')
      .send({ email: ADMIN, code: sent.at(-1)!.code });
    return {
      access: signed.body.accessToken as string,
      refresh: cookie(signed),
      cookieName: 'sd_platform_refresh',
    };
  }
});

describe('platform administrator row', () => {
  it('updates the address and revokes live sessions', async () => {
    const pool = ownerPool();
    await pool.query('insert into platform_administrator (email) values ($1)', [
      ADMIN,
    ]);
    await pool.query(
      `insert into session (
         platform_administrator_id, api, expires_at, refresh_token_hash
       )
       select id, 'platform', now() + interval '1 day', 'hash'
         from platform_administrator`,
    );
    await ensurePlatformAdministrator(pool, 'new@example.com');
    const admin = await pool.query<{ email: string }>(
      'select email from platform_administrator',
    );
    const session = await pool.query<{ revoked_at: Date | null }>(
      'select revoked_at from session',
    );
    await pool.end();
    expect(admin.rows[0]?.email).toBe('new@example.com');
    expect(session.rows[0]?.revoked_at).toBeTruthy();
  });

  it('rejects a second administrator', async () => {
    const pool = ownerPool();
    await pool.query('insert into platform_administrator (email) values ($1)', [
      ADMIN,
    ]);
    await expect(
      pool.query('insert into platform_administrator (email) values ($1)', [
        'second@example.com',
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await pool.end();
  });
});

function cookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const line = Array.isArray(raw) ? raw[0] : raw;
  const value = /sd_platform_refresh=([^;]+)/.exec(line ?? '')?.[1];
  if (!value) throw new Error('refresh cookie was not set');
  return value;
}
