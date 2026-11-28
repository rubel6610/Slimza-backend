import { Module } from '@nestjs/common';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';
import { MailModule } from '../mail/mail.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';

@Module({
  imports: [MailModule, LoyaltyModule, WalletModule, SubscriptionsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
