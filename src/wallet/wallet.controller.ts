import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { addTestCardSchema, cardIdParamSchema, type AddTestCardInput } from './wallet.schemas.js';
import { WalletService } from './wallet.service.js';

/**
 * Wallet (docs/WALLET.md): saved cards + payment history. No store credit (Stripe payments only).
 *   Customer: GET /wallet · POST /wallet/cards/setup-intent · POST /wallet/cards (test mode only)
 *             PATCH /wallet/cards/:id/default · DELETE /wallet/cards/:id
 */
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Roles(UserRole.CUSTOMER)
  @Get()
  summary(@CurrentUser() user: AuthUserPayload) {
    return this.wallet.summary(user.sub);
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
}
