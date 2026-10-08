import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MAILER, type Mailer } from '../src/common/auth/mailer.js';
import { signAccessToken } from '../src/common/auth/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp } from './support/app.js';
import { ownerPool } from './support/db.js';
import { fixtureImports } from './support/fixtures.js';

const ANNA = 'anna@example.com';
const OLGA = 'olga@example.com';
const NOBODY = 'nobody@example.com';
const COOKIE = 'sd_studio_refresh';

describe('studio sign-in', () => {
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

  beforeEach(() => {
    sent.length = 0;
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

  async function createStudio(
    name: string,
    ownerEmail: string,
    status = 'active',
  ) {
    const rows = await sql<{ id: string }>(
      `insert into studio (name, subdomain, owner_email, status)
       values ($1, $2, $3, $4) returning id`,
      [name, name.toLowerCase().replace(/\s+/g, '-'), ownerEmail, status],
    );
    return rows[0]!.id;
  }

  async function addStaff(
    studioId: string,
    email: string,
    role = 'administrator',
  ) {
    await sql(
      'insert into studio_staff (studio_id, email, role) values ($1, $2, $3)',
      [studioId, email, role],
    );
  }

  async function requestCode(email: string) {
    return http().post('/api/studio/auth/code').send({ email });
  }

  function latestCode() {
    const item = sent.at(-1);
    if (!item) throw new Error('code was not sent');
    return item.code;
  }

  async function signInRequest(email: string) {
    await requestCode(email);
    return http()
      .post('/api/studio/auth/sign-in')
      .send({ email, code: latestCode() });
  }

  function refreshCookie(res: request.Response): string {
    const raw = res.headers['set-cookie'];
    const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const value = lines
      .map((line) => new RegExp(`${COOKIE}=([^;]*)`).exec(line)?.[1])
      .find((item) => item);
    if (!value) throw new Error('refresh cookie was not set');
    return value;
  }

  function withBearer(token: string) {
    return http()
      .get('/api/studio/fixture/closed')
      .set('Authorization', `Bearer ${token}`);
  }

  describe('code request', () => {
    it('answers the same for any e-mail and mails only owners and staff of active studios', async () => {
      const yoga = await createStudio('Yoga', ANNA);
      await addStaff(yoga, OLGA);
      await createStudio('Closed', 'gone@example.com', 'deactivated');

      const owner = await requestCode('Anna@Example.com');
      const staff = await requestCode(OLGA);
      const unknown = await requestCode(NOBODY);
      const deactivated = await requestCode('gone@example.com');

      expect(owner.status).toBe(200);
      expect(owner.body).toEqual({ codeExpiresIn: 600, resendAvailableIn: 60 });
      for (const other of [staff, unknown, deactivated]) {
        expect(other.status).toBe(200);
        expect(other.body).toEqual(owner.body);
      }
      expect(sent.map((item) => item.email)).toEqual([ANNA, OLGA]);
    });

    it('refuses a second code before the wait is over, for any e-mail', async () => {
      await requestCode(NOBODY);
      const again = await requestCode(NOBODY);
      expect(again.status).toBe(429);
      expect(again.body.code).toBe('RESEND_TOO_EARLY');
    });

    it('does not share codes with the platform sign-in', async () => {
      await createStudio('Yoga', ANNA);
      await requestCode(ANNA);
      await http().post('/api/platform/auth/code').send({ email: ANNA });
      const signed = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: ANNA, code: latestCode() });
      expect(signed.status).toBe(200);
    });
  });

  describe('sign-in', () => {
    it('gives an e-mail without an active studio the answer of a wrong code, even with the correct code', async () => {
      const yoga = await createStudio('Yoga', ANNA);
      await requestCode(ANNA);
      const code = latestCode();
      await sql(`update studio set status = 'deactivated' where id = $1`, [
        yoga,
      ]);

      const rejected = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: ANNA, code });
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('INVALID_CODE');

      await requestCode(NOBODY);
      const unknown = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: NOBODY, code: '000000' });
      expect(unknown.status).toBe(rejected.status);
      expect(unknown.body.code).toBe(rejected.body.code);
      expect(await sql('select id from studio_session')).toEqual([]);
    });

    it('locks the code after five wrong attempts, also for an e-mail without a studio', async () => {
      await requestCode(NOBODY);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const res = await http()
          .post('/api/studio/auth/sign-in')
          .send({ email: NOBODY, code: '000000' });
        expect(res.body.code).toBe('INVALID_CODE');
      }
      const last = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: NOBODY, code: '000000' });
      expect(last.status).toBe(429);
      expect(last.body.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('reports CODE_EXPIRED for a recently expired code', async () => {
      await createStudio('Yoga', ANNA);
      await requestCode(ANNA);
      await sql(
        `update studio_sign_in_code set expires_at = now() - interval '10 minutes'`,
      );
      const res = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: ANNA, code: latestCode() });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CODE_EXPIRED');
    });

    it('signs an owner of one studio in at once, and the code works only once', async () => {
      const yoga = await createStudio('Yoga', ANNA);
      await requestCode('ANNA@example.com');
      const code = latestCode();
      const signed = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: 'Anna@Example.com', code });

      expect(signed.status).toBe(200);
      expect(signed.body).toMatchObject({
        result: 'signed-in',
        accessTokenExpiresIn: 900,
        user: { email: ANNA },
        studio: { id: yoga, name: 'Yoga' },
      });
      expect(signed.body.refreshToken).toBeUndefined();
      expect(refreshCookie(signed)).toBeTruthy();
      expect(String(signed.headers['set-cookie'])).toContain(
        'Path=/api/studio/auth',
      );

      const again = await http()
        .post('/api/studio/auth/sign-in')
        .send({ email: ANNA, code });
      expect(again.body.code).toBe('INVALID_CODE');
    });

    it('signs a staff member in at once', async () => {
      const yoga = await createStudio('Yoga', ANNA);
      await addStaff(yoga, OLGA, 'accountant');
      const signed = await signInRequest('olga@example.com');
      expect(signed.body.result).toBe('signed-in');
      expect(signed.body.studio.id).toBe(yoga);
      expect(signed.body.user).toEqual({ email: OLGA });
    });

    it('creates no session for several studios and returns a ticket with the studios by name', async () => {
      await createStudio('Zen', ANNA);
      const pilates = await createStudio('Pilates', 'other@example.com');
      await addStaff(pilates, ANNA);
      await createStudio('Hidden', ANNA, 'deactivated');

      const signed = await signInRequest(ANNA);
      expect(signed.status).toBe(200);
      expect(signed.body.result).toBe('studio-selection');
      expect(signed.body.selectionTicketExpiresIn).toBe(300);
      expect(
        signed.body.studios.map((item: { name: string }) => item.name),
      ).toEqual(['Pilates', 'Zen']);
      expect(signed.headers['set-cookie']).toBeUndefined();
      expect(signed.body.accessToken).toBeUndefined();
      expect(await sql('select id from studio_session')).toEqual([]);
    });
  });

  describe('studio selection', () => {
    async function twoStudios() {
      const zen = await createStudio('Zen', ANNA);
      const pilates = await createStudio('Pilates', 'other@example.com');
      await addStaff(pilates, ANNA);
      const signed = await signInRequest(ANNA);
      return {
        zen,
        pilates,
        ticket: signed.body.selectionTicket as string,
      };
    }

    it('exchanges the ticket for a session of the chosen studio, once', async () => {
      const { pilates, ticket } = await twoStudios();
      const chosen = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: ticket, studioId: pilates });
      expect(chosen.status).toBe(200);
      expect(chosen.body.studio).toEqual({ id: pilates, name: 'Pilates' });
      expect(refreshCookie(chosen)).toBeTruthy();
      expect((await withBearer(chosen.body.accessToken)).status).toBe(200);

      const reused = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: ticket, studioId: pilates });
      expect(reused.status).toBe(400);
      expect(reused.body.code).toBe('INVALID_SELECTION_TICKET');
    });

    it('replaces every earlier ticket of the person with the new one, and removes old tickets of others', async () => {
      const { zen, ticket: first } = await twoStudios();
      await sql(
        `insert into studio_selection_ticket (token_hash, email, expires_at)
         values ('stale', 'other@example.com', now() - interval '2 hours'),
                ('fresh', 'other@example.com', now() + interval '1 minute')`,
      );

      const again = await signInRequest(ANNA);
      const second = again.body.selectionTicket as string;
      expect(second).not.toBe(first);

      const rows = await sql<{ token_hash: string }>(
        'select token_hash from studio_selection_ticket order by token_hash',
      );
      expect(rows.map((row) => row.token_hash)).toHaveLength(2);
      expect(rows.map((row) => row.token_hash)).toContain('fresh');
      expect(rows.map((row) => row.token_hash)).not.toContain('stale');

      const old = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: first, studioId: zen });
      expect(old.status).toBe(400);
      expect(old.body.code).toBe('INVALID_SELECTION_TICKET');
      const current = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: second, studioId: zen });
      expect(current.status).toBe(200);
    });

    it('rejects an expired or unknown ticket', async () => {
      const { zen, ticket } = await twoStudios();
      await sql(
        `update studio_selection_ticket set expires_at = now() - interval '1 second'`,
      );
      const expired = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: ticket, studioId: zen });
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('INVALID_SELECTION_TICKET');

      const unknown = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: 'nope', studioId: zen });
      expect(unknown.body.code).toBe('INVALID_SELECTION_TICKET');
    });

    it('does not give a studio the person is not linked to or that was deactivated since', async () => {
      const { zen, pilates, ticket } = await twoStudios();
      const foreign = await createStudio('Foreign', 'stranger@example.com');
      const notLinked = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: ticket, studioId: foreign });
      expect(notLinked.status).toBe(404);
      expect(notLinked.body.code).toBe('NOT_FOUND');

      await sql(`update studio set status = 'deactivated' where id = $1`, [
        zen,
      ]);
      const deactivated = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: ticket, studioId: zen });
      expect(deactivated.status).toBe(404);

      const chosen = await http()
        .post('/api/studio/auth/select-studio')
        .send({ selectionTicket: ticket, studioId: pilates });
      expect(chosen.status).toBe(200);
    });

    it('reports every format error of the body together', async () => {
      const res = await http()
        .post('/api/studio/auth/select-studio')
        .send({ studioId: 'not-a-uuid' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(
        res.body.errors.map((item: { field: string }) => item.field).sort(),
      ).toEqual(['selectionTicket', 'studioId']);
    });
  });

  describe('switching studio', () => {
    async function signedInToTwo() {
      const zen = await createStudio('Zen', ANNA);
      const pilates = await createStudio('Pilates', 'other@example.com');
      await addStaff(pilates, ANNA);
      const signed = await signInRequest(ANNA);
      const chosen = await http().post('/api/studio/auth/select-studio').send({
        selectionTicket: signed.body.selectionTicket,
        studioId: zen,
      });
      return {
        zen,
        pilates,
        access: chosen.body.accessToken as string,
        refresh: refreshCookie(chosen),
      };
    }

    function switchTo(access: string, studioId: string, header = true) {
      const call = http()
        .post('/api/studio/auth/switch-studio')
        .set('Authorization', `Bearer ${access}`)
        .send({ studioId });
      return header ? call.set('X-Requested-With', 'fetch') : call;
    }

    it('creates a new session of the other studio and revokes the current one without a new code', async () => {
      const { pilates, access, refresh } = await signedInToTwo();
      const switched = await switchTo(access, pilates);
      expect(switched.status).toBe(200);
      expect(switched.body.studio).toEqual({ id: pilates, name: 'Pilates' });
      expect(refreshCookie(switched)).not.toBe(refresh);

      expect((await withBearer(access)).status).toBe(401);
      expect((await withBearer(switched.body.accessToken)).status).toBe(200);
      const sessions = await sql<{ revoked: boolean }>(
        'select revoked_at is not null as revoked from studio_session order by created_at',
      );
      expect(sessions.map((item) => item.revoked)).toEqual([true, false]);
    });

    it('keeps the log-in-as-studio mark on the new session', async () => {
      const { pilates, access } = await signedInToTwo();
      const [admin] = await sql<{ id: string }>(
        `insert into platform_administrator (email) values ('admin@example.com') returning id`,
      );
      await sql('update studio_session set impersonated_by = $1', [admin!.id]);

      const switched = await switchTo(access, pilates);
      expect(switched.status).toBe(200);
      const marks = await sql<{ impersonated_by: string | null }>(
        'select impersonated_by from studio_session order by created_at',
      );
      expect(marks.map((item) => item.impersonated_by)).toEqual([
        admin!.id,
        admin!.id,
      ]);
    });

    it('does not give a studio the person is not linked to or a deactivated one', async () => {
      const { pilates, access } = await signedInToTwo();
      const foreign = await createStudio('Foreign', 'stranger@example.com');
      const notLinked = await switchTo(access, foreign);
      expect(notLinked.status).toBe(404);
      expect(notLinked.body.code).toBe('NOT_FOUND');

      await sql(`update studio set status = 'deactivated' where id = $1`, [
        pilates,
      ]);
      expect((await switchTo(access, pilates)).status).toBe(404);
      expect((await withBearer(access)).status).toBe(200);
    });

    it('needs a token and the requested-with header', async () => {
      const { pilates, access } = await signedInToTwo();
      expect((await switchTo(access, pilates, false)).status).toBe(403);
      const anonymous = await http()
        .post('/api/studio/auth/switch-studio')
        .set('X-Requested-With', 'fetch')
        .send({ studioId: pilates });
      expect(anonymous.status).toBe(401);
    });
  });

  describe('tokens and sessions', () => {
    async function signedIn() {
      const yoga = await createStudio('Yoga', ANNA);
      const signed = await signInRequest(ANNA);
      return {
        yoga,
        access: signed.body.accessToken as string,
        refresh: refreshCookie(signed),
      };
    }

    function refreshWith(value: string) {
      return http()
        .post('/api/studio/auth/refresh')
        .set('X-Requested-With', 'fetch')
        .set('Cookie', `${COOKIE}=${value}`);
    }

    it('accepts the access token for its session, and rejects it after sign-out', async () => {
      const { access, refresh } = await signedIn();
      expect((await withBearer(access)).status).toBe(200);

      const out = await http()
        .post('/api/studio/auth/sign-out')
        .set('X-Requested-With', 'fetch')
        .set('Cookie', `${COOKIE}=${refresh}`);
      expect(out.status).toBe(204);
      expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
      expect((await withBearer(access)).status).toBe(401);
    });

    it('works only for the studio of the session', async () => {
      const { access } = await signedIn();
      const other = await createStudio('Other', 'stranger@example.com');
      expect((await withBearer(access)).status).toBe(200);

      await sql('update studio_session set studio_id = $1', [other]);
      expect((await withBearer(access)).status).toBe(401);
    });

    it('does not accept a platform token in the studio API, or a studio token in the platform API', async () => {
      const { access } = await signedIn();
      const secret = loadEnv().ACCESS_TOKEN_SECRET;
      const platformToken = signAccessToken(
        { sub: 'someone', sid: 'some-session', api: 'platform' },
        secret,
      );
      expect((await withBearer(platformToken)).status).toBe(401);

      const studioOnPlatform = await http()
        .get('/api/platform/fixture/closed')
        .set('Authorization', `Bearer ${access}`);
      expect(studioOnPlatform.status).toBe(401);
    });

    it('rejects a studio token without a studio, a tampered token, and an expired session', async () => {
      const { access } = await signedIn();
      const secret = loadEnv().ACCESS_TOKEN_SECRET;
      const claims = JSON.parse(
        Buffer.from(access.split('.')[1]!, 'base64url').toString('utf8'),
      ) as { sub: string; sid: string };
      const withoutStudio = signAccessToken(
        { sub: claims.sub, sid: claims.sid, api: 'studio' },
        secret,
      );
      expect((await withBearer(withoutStudio)).status).toBe(401);
      expect((await withBearer(`${access}x`)).status).toBe(401);

      await sql(
        `update studio_session set expires_at = now() - interval '1 second'`,
      );
      expect((await withBearer(access)).status).toBe(401);
    });

    it('rotates the refresh token and accepts the previous one for a few seconds', async () => {
      const { refresh } = await signedIn();
      const first = await refreshWith(refresh);
      expect(first.status).toBe(200);
      expect(first.body.user).toEqual({ email: ANNA });
      expect(first.body.studio.name).toBe('Yoga');
      expect(refreshCookie(first)).not.toBe(refresh);

      const withinWindow = await refreshWith(refresh);
      expect(withinWindow.status).toBe(200);
    });

    it('revokes the session when the previous refresh token comes too late', async () => {
      const { access, refresh } = await signedIn();
      expect((await refreshWith(refresh)).status).toBe(200);
      await sql(
        `update studio_session set rotated_at = now() - interval '11 seconds'`,
      );

      const reused = await refreshWith(refresh);
      expect(reused.status).toBe(401);
      expect(reused.body.code).toBe('SESSION_EXPIRED');
      expect((await withBearer(access)).status).toBe(401);
    });

    it('requires the requested-with header and the cookie, and tells apart a missing and an unknown cookie', async () => {
      const missingHeader = await http().post('/api/studio/auth/refresh');
      expect(missingHeader.status).toBe(403);

      const missingCookie = await http()
        .post('/api/studio/auth/refresh')
        .set('X-Requested-With', 'fetch');
      expect(missingCookie.status).toBe(401);
      expect(missingCookie.body.code).toBe('UNAUTHORIZED');

      const unknown = await refreshWith('unknown');
      expect(unknown.status).toBe(401);
      expect(unknown.body.code).toBe('SESSION_EXPIRED');
    });

    it('answers 204 to sign-out without a cookie, and requires the header', async () => {
      const withoutCookie = await http()
        .post('/api/studio/auth/sign-out')
        .set('X-Requested-With', 'fetch');
      expect(withoutCookie.status).toBe(204);
      const withoutHeader = await http().post('/api/studio/auth/sign-out');
      expect(withoutHeader.status).toBe(403);
    });
  });
});
