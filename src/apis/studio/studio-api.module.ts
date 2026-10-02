import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { StudioAuthGuard } from './studio-auth.guard.js';

/** Studio admin API, served under /api/studio. */
@Module({
  imports: [DatabaseModule.forApi('studio_api')],
  providers: [StudioAuthGuard],
  exports: [StudioAuthGuard],
})
export class StudioApiModule {}
