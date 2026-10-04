import type { INestApplication } from '@nestjs/common';
import { setupOpenApi } from './common/openapi/setup-openapi.js';
import { loadEnv } from './config/env.js';

/** Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.enableCors({
    origin: [
      'https://admin.studio-desk.axondigital.xyz',
      'https://app.studio-desk.axondigital.xyz',
    ],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  });
  if (loadEnv().APP_ENV !== 'production') setupOpenApi(app);
}
