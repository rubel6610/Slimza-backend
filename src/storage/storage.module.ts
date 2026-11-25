import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { StorageController } from './storage.controller.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  controllers: [StorageController],
  providers: [StorageService],
  imports: [ConfigModule],
  exports: [StorageService],
})
export class StorageModule {}
