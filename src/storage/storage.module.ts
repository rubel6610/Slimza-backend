import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { StorageController } from './storage.controller.js';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  controllers: [StorageController],
  providers: [StorageService],
  imports: [ConfigModule],
  exports: [StorageService],
})
export class StorageModule {}
