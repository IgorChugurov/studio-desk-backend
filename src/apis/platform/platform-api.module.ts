import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { StudiosController } from './organizations/organizations.controller.js';
import { StudiosService } from './organizations/organizations.service.js';
import { PresetsController } from './presets/presets.controller.js';
import { PresetsService } from './presets/presets.service.js';
import { MAILER, ResendMailer } from '../../common/auth/mailer.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import { VersionController } from './version/version.controller.js';

/** Platform admin API, served under /api/platform. */
@Module({
  imports: [DatabaseModule.forApi('platform_api')],
  controllers: [
    AuthController,
    PresetsController,
    StudiosController,
    VersionController,
  ],
  providers: [
    PlatformAuthGuard,
    AuthService,
    PresetsService,
    StudiosService,
    { provide: MAILER, useClass: ResendMailer },
  ],
  exports: [PlatformAuthGuard],
})
export class PlatformApiModule {}
