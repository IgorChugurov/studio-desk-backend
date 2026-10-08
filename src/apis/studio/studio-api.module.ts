import { Module } from '@nestjs/common';
import { MAILER, ResendMailer } from '../../common/auth/mailer.js';
import { DatabaseModule } from '../../database/database.module.js';
import { StudioAuthController } from './auth/studio-auth.controller.js';
import { StudioAuthService } from './auth/studio-auth.service.js';
import { StudioSettingsController } from './settings/studio-settings.controller.js';
import { StudioSettingsService } from './settings/studio-settings.service.js';
import { StudioAuthGuard } from './studio-auth.guard.js';

/** Studio admin API, served under /api/studio. */
@Module({
  imports: [DatabaseModule.forApi('studio_api')],
  controllers: [StudioAuthController, StudioSettingsController],
  providers: [
    StudioAuthGuard,
    StudioAuthService,
    StudioSettingsService,
    { provide: MAILER, useClass: ResendMailer },
  ],
  exports: [StudioAuthGuard],
})
export class StudioApiModule {}
