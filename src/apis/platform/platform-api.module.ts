import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';

/** Platform admin API, served under /api/platform. */
@Module({
  imports: [DatabaseModule.forApi('platform_api')],
  providers: [PlatformAuthGuard],
  exports: [PlatformAuthGuard],
})
export class PlatformApiModule {}
