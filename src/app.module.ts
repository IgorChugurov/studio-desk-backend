import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, RouterModule } from '@nestjs/core';
import { PlatformApiModule } from './apis/platform/platform-api.module.js';
import { PublicApiModule } from './apis/public/public-api.module.js';
import { StudioApiModule } from './apis/studio/studio-api.module.js';
import { ApiAuthGuard } from './common/auth/api-auth.guard.js';
import { ApiExceptionFilter } from './common/errors/api-exception.filter.js';
import { HealthModule } from './health/health.module.js';

export const API_ROUTES = [
  { path: 'platform', module: PlatformApiModule },
  { path: 'studio', module: StudioApiModule },
  { path: 'public', module: PublicApiModule },
];

@Module({
  imports: [
    PlatformApiModule,
    StudioApiModule,
    PublicApiModule,
    RouterModule.register(API_ROUTES),
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiAuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
