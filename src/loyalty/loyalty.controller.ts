import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  adminLoyaltyAdjustSchema,
  adminLoyaltyCustomersQuerySchema,
  adminLoyaltyTransactionsQuerySchema,
  socialPlatformParamSchema,
  type AdminLoyaltyAdjustInput,
  type AdminLoyaltyCustomersQuery,
  type AdminLoyaltyTransactionsQuery,
} from './loyalty.schemas.js';
import { LoyaltyService } from './loyalty.service.js';

/**
 * Slimza Rewards. Settings are the CMS section "loyalty" (GET /cms, PUT /cms/loyalty).
 * Points are spent at checkout via `pointsToRedeem` on the checkout endpoints.
 */
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  /** The signed-in customer's balance, tier and history (also grants due welcome/birthday bonuses). */
  @Roles(UserRole.CUSTOMER)
  @Get('me')
  me(@CurrentUser() user: AuthUserPayload) {
    return this.loyaltyService.getSummary(user.sub);
  }

  @Roles(UserRole.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('me/social/:platform')
  claimSocial(@CurrentUser() user: AuthUserPayload, @Param('platform', { schema: socialPlatformParamSchema }) platform: string) {
    return this.loyaltyService.claimSocial(user.sub, platform);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/stats')
  stats() {
    return this.loyaltyService.adminStats();
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/customers')
  customers(@Query({ schema: adminLoyaltyCustomersQuerySchema }) query: AdminLoyaltyCustomersQuery) {
    return this.loyaltyService.adminCustomers(query);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/transactions')
  transactions(@Query({ schema: adminLoyaltyTransactionsQuerySchema }) query: AdminLoyaltyTransactionsQuery) {
    return this.loyaltyService.adminTransactions(query);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/adjust')
  adjust(@Body({ schema: adminLoyaltyAdjustSchema }) body: AdminLoyaltyAdjustInput) {
    return this.loyaltyService.adminAdjust(body);
  }
}
