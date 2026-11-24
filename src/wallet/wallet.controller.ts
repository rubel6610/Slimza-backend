import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  addTestCardSchema,
  adminAdjustSchema,
  cardIdParamSchema,
  userIdParamSchema,
  walletHistoryQuerySchema,
  type AddTestCardInput,
  type AdminAdjustInput,
  type WalletHistoryQuery,
} from './wallet.schemas.js';
import { WalletService } from './wallet.service.js';

/**
 * Wallet (docs/WALLET.md).
 *   Customer: GET /wallet · GET /wallet/transactions · POST /wallet/cards/setup-intent
 *             POST /wallet/cards (test mode only: brand / last 4 / expiry)
 *             PATCH /wallet/cards/:id/default · DELETE /wallet/cards/:id
 *   Admin:    GET /wallet/admin/users/:userId · POST /wallet/admin/users/:userId/adjust
 */
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Roles(UserRole.CUSTOMER)
  @Get()
  summary(@CurrentUser() user: AuthUserPayload, @Query({ schema: walletHistoryQuerySchema }) query: WalletHistoryQuery) {
    return this.wallet.summary(user.sub, query);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('transactions')
  history(@CurrentUser() user: AuthUserPayload, @Query({ schema: walletHistoryQuerySchema }) query: WalletHistoryQuery) {
    return this.wallet.history(user.sub, query);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('cards/setup-intent')
  setupIntent(@CurrentUser() user: AuthUserPayload) {
    return this.wallet.createSetupIntent(user.sub);
  }

  /** Test mode (no Stripe keys): save a card's brand / last 4 / expiry to the wallet. */
  @Roles(UserRole.CUSTOMER)
  @Post('cards')
  addTestCard(@CurrentUser() user: AuthUserPayload, @Body({ schema: addTestCardSchema }) body: AddTestCardInput) {
    return this.wallet.addTestCard(user.sub, body);
  }

  @Roles(UserRole.CUSTOMER)
  @Patch('cards/:id/default')
  setDefault(@CurrentUser() user: AuthUserPayload, @Param('id', { schema: cardIdParamSchema }) id: string) {
    return this.wallet.setDefaultCard(user.sub, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Delete('cards/:id')
  remove(@CurrentUser() user: AuthUserPayload, @Param('id', { schema: cardIdParamSchema }) id: string) {
    return this.wallet.removeCard(user.sub, id);
  }

  // ---- Admin ----

  @Roles(UserRole.ADMIN)
  @Get('admin/users/:userId')
  async adminView(@Param('userId', { schema: userIdParamSchema }) userId: string, @Query({ schema: walletHistoryQuerySchema }) query: WalletHistoryQuery) {
    const [balance, transactions] = await Promise.all([this.wallet.balance(userId), this.wallet.history(userId, query)]);
    return { balance, transactions };
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/users/:userId/adjust')
  adjust(
    @CurrentUser() admin: AuthUserPayload,
    @Param('userId', { schema: userIdParamSchema }) userId: string,
    @Body({ schema: adminAdjustSchema }) body: AdminAdjustInput,
  ) {
    return this.wallet.adminAdjust(userId, body.amount, body.reason, admin.sub);
  }
}
