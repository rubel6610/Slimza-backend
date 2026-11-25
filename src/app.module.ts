import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { CmsModule } from './cms/cms.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { BlogsModule } from './blogs/blogs.module.js';
import { LoyaltyModule } from './loyalty/loyalty.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { WellnessHubModule } from './wellness-hub/wellness-hub.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { FranchiseModule } from './franchise/franchise.module.js';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware.js';
import { MailModule } from './mail/mail.module.js';
import { MediaModule } from './media/media.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductsModule } from './products/products.module.js';
import { UsersModule } from './users/users.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'slimza_backend',
    }),
    PrismaModule,
    MediaModule,
    MailModule,
    AuthModule,
    UsersModule,
    CmsModule,
    CouponsModule,
    CheckoutModule,
    ProductsModule,
    FranchiseModule,
    BlogsModule,
    LoyaltyModule,
    ReviewsModule,
    WellnessHubModule,
    WalletModule,
    SubscriptionsModule,
    RedisModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes('{*path}');
  }
}
