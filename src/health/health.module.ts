import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule.forApi('public_api')],
  controllers: [HealthController],
})
export class HealthModule {}
