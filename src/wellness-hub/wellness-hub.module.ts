import { Module } from '@nestjs/common';
import { WellnessHubController } from './wellness-hub.controller.js';
import { WellnessHubService } from './wellness-hub.service.js';

@Module({
  controllers: [WellnessHubController],
  providers: [WellnessHubService],
  exports: [WellnessHubService],
})
export class WellnessHubModule {}
