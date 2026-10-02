import type { INestApplication } from '@nestjs/common';
import { setupOpenApi } from './common/openapi/setup-openapi.js';
import { loadEnv } from './config/env.js';

/** Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  if (loadEnv().APP_ENV !== 'production') setupOpenApi(app);
}
