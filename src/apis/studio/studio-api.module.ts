import { Module } from '@nestjs/common';
import { MAILER, ResendMailer } from '../../common/auth/mailer.js';
import { DatabaseModule } from '../../database/database.module.js';
import { StudioAccessService } from './access/studio-access.service.js';
import { StudioClassTypesController } from './halls/studio-class-types.controller.js';
import { StudioClassTypesService } from './halls/studio-class-types.service.js';
import { StudioHallsController } from './halls/studio-halls.controller.js';
import { StudioHallsService } from './halls/studio-halls.service.js';
import { StudioTrainersController } from './halls/studio-trainers.controller.js';
import { StudioTrainersService } from './halls/studio-trainers.service.js';
import { StudioAuthController } from './auth/studio-auth.controller.js';
import { StudioAuthService } from './auth/studio-auth.service.js';
import { StudioMeController } from './me/studio-me.controller.js';
import { StudioMeService } from './me/studio-me.service.js';
import { StudioSettingsController } from './settings/studio-settings.controller.js';
import { StudioSettingsService } from './settings/studio-settings.service.js';
import { StudioStaffController } from './staff/studio-staff.controller.js';
import { StudioStaffService } from './staff/studio-staff.service.js';
import { StudioAuthGuard } from './studio-auth.guard.js';

/** Studio admin API, served under /api/studio. */
@Module({
  imports: [DatabaseModule.forApi('studio_api')],
  controllers: [
    StudioAuthController,
    StudioMeController,
    StudioSettingsController,
    StudioStaffController,
    StudioHallsController,
    StudioTrainersController,
    StudioClassTypesController,
  ],
  providers: [
    StudioAuthGuard,
    StudioAuthService,
    StudioAccessService,
    StudioMeService,
    StudioSettingsService,
    StudioStaffService,
    StudioHallsService,
    StudioTrainersService,
    StudioClassTypesService,
    { provide: MAILER, useClass: ResendMailer },
  ],
  exports: [StudioAuthGuard],
})
export class StudioApiModule {}
