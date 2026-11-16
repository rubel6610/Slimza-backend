import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CmsController } from './cms.controller.js';
import { CmsService } from './cms.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
