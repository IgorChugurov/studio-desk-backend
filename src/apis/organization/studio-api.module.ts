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
import { ClassesController } from './schedule/classes.controller.js';
import { ClassesService } from './schedule/classes.service.js';
import { WeekTemplatesController } from './schedule/week-templates.controller.js';
import { WeekTemplatesService } from './schedule/week-templates.service.js';
import { WeeksController } from './schedule/weeks.controller.js';
import { WeeksService } from './schedule/weeks.service.js';
import { StudioStaffController } from './staff/studio-staff.controller.js';
import { StudioStaffService } from './staff/studio-staff.service.js';
import { StudioAuthGuard } from './studio-auth.guard.js';

/** Studio admin API, served under /api/organization. */
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
    WeekTemplatesController,
    ClassesController,
    WeeksController,
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
    WeekTemplatesService,
    ClassesService,
    WeeksService,
    { provide: MAILER, useClass: ResendMailer },
  ],
  exports: [StudioAuthGuard],
})
export class StudioApiModule {}
