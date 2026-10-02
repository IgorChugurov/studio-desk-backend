import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { OPENAPI_PUBLIC_EXTENSION } from '../src/common/auth/public.decorator.js';
import { createTestApp } from './support/app.js';
import { fixtureImports } from './support/fixtures.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Walks every route of the application and calls it without a token.
 * Every route must answer 401 UNAUTHORIZED unless it is explicitly marked open.
 */
describe('route protection', () => {
  let app: INestApplication;
  let routes: {
    method: (typeof METHODS)[number];
    path: string;
    isPublic: boolean;
  }[];

  beforeAll(async () => {
    app = await createTestApp({ imports: fixtureImports });
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    routes = Object.entries(document.paths).flatMap(([path, item]) =>
      METHODS.filter((method) => item[method]).map((method) => ({
        method,
        path: path.replace(/\{[^}]+\}/g, 'x'),
        isPublic:
          (item[method] as unknown as Record<string, unknown>)[
            OPENAPI_PUBLIC_EXTENSION
          ] === true,
      })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('sees closed routes of all three APIs, a route outside them, and /api/health', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/platform/fixture/closed',
        '/api/studio/fixture/closed',
        '/api/public/fixture/closed',
        '/api/outside/closed',
        '/api/health',
      ]),
    );
  });

  it('every closed route rejects a request without a token', async () => {
    const closed = routes.filter((r) => !r.isPublic);
    expect(closed.length).toBeGreaterThan(0);
    for (const route of closed) {
      const res = await request(app.getHttpServer())[route.method](route.path);
      expect({ route, status: res.status, code: res.body.code }).toEqual({
        route,
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }
  });

  it('closed routes reject a request with a token as well (no verification yet)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/platform/fixture/closed')
      .set('Authorization', 'Bearer anything');
    expect(res.status).toBe(401);
  });

  it('routes marked open pass the guard', async () => {
    for (const path of ['/api/platform/fixture/open', '/api/health']) {
      const res = await request(app.getHttpServer()).get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });
});
