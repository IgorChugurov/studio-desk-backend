import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PublicAuthGuard } from './public-auth.guard.js';

/** Public API (studio sites and clients), served under /api/public. */
@Module({
  imports: [DatabaseModule.forApi('public_api')],
  providers: [PublicAuthGuard],
  exports: [PublicAuthGuard],
})
export class PublicApiModule {}
