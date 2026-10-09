import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { storageRoot } from './apis/studio/halls/storage-path.js';
import { setupOpenApi } from './common/openapi/setup-openapi.js';
import { loadEnv } from './config/env.js';

/** Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  const expressApp = app as NestExpressApplication;
  // CORS must run before the file folder. The browser sends OPTIONS first
  // when the page asks for a file with the session header.
  app.enableCors({
    origin: [
      'https://admin.studio-desk.axondigital.xyz',
      'https://app.studio-desk.axondigital.xyz',
      ...loadEnv().CORS_EXTRA_ORIGINS,
    ],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  });
  expressApp.useStaticAssets(storageRoot(), {
    prefix: '/files',
    index: false,
    redirect: false,
  });
  expressApp.use('/files', (req: Request, res: Response, next: () => void) => {
    if (res.headersSent) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.status(404).json({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'File not found',
    });
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  if (loadEnv().APP_ENV !== 'production') setupOpenApi(app);
}
