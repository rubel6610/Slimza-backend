import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { FranchiseController } from './franchise.controller.js';
import { FranchiseService } from './franchise.service.js';

@Module({
  imports: [MailModule],
  controllers: [FranchiseController],
  providers: [FranchiseService],
})
export class FranchiseModule {}
