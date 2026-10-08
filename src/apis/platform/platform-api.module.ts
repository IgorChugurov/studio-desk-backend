import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { StudiosController } from './studios/studios.controller.js';
import { StudiosService } from './studios/studios.service.js';
import { MAILER, ResendMailer } from '../../common/auth/mailer.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import { VersionController } from './version/version.controller.js';

/** Platform admin API, served under /api/platform. */
@Module({
  imports: [DatabaseModule.forApi('platform_api')],
  controllers: [AuthController, StudiosController, VersionController],
  providers: [
    PlatformAuthGuard,
    AuthService,
    StudiosService,
    { provide: MAILER, useClass: ResendMailer },
  ],
  exports: [PlatformAuthGuard],
})
export class PlatformApiModule {}
