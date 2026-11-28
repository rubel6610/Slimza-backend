import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service.js';
import { cardBrandName, type SavedCard } from './wallet-rules.js';
import type { AddTestCardInput } from './wallet.schemas.js';

/**
 * The customer's wallet (docs/WALLET.md): saved cards and their payment history.
 * There is NO store credit — Slimza takes payments through Stripe only and refunds go back to the card.
 *  - saved cards: kept by Stripe on the customer's Stripe Customer; we only show brand / last 4 / expiry.
 *    Without Stripe (test mode) they are kept in WalletCard — brand / last 4 / expiry only.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly stripe: Stripe | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY') ?? process.env.STRIPE_SECRET_KEY ?? '';
    this.stripe = key ? new Stripe(key) : null;
  }

  /** Saved cards always work: in Stripe (live) or, without Stripe keys, in our WalletCard table (test mode). */
  get cardsEnabled() {
    return true;
  }

  /** stripe = cards live in Stripe; test = Stripe isn't configured, cards are kept by us (no numbers). */
  get cardsMode(): 'stripe' | 'test' {
    return this.stripe ? 'stripe' : 'test';
  }

  // ---- Payments ----------------------------------------------------------------------

  /**
   * Account → Wallet → Payments: the customer's paid orders and the card they used.
   * Same ownership rule as "My orders": linked to the account, or placed with its email.
   */
  async payments(userId: string, limit = 10) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = user?.email?.trim().toLowerCase();
    const orders = await this.prisma.order.findMany({
      where: {
        OR: [{ userId }, ...(email ? [{ customerEmail: email }] : [])],
        paymentStatus: { in: ['PAID', 'REFUNDED'] },
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        total: true,
        paymentMode: true,
        paymentLabel: true,
        paymentStatus: true,
        status: true,
      },
    });
    return orders.map((o) => ({
      ...o,
      // Orders from before payment labels were saved
      paymentLabel: o.paymentLabel || (o.paymentMode === 'demo' ? 'Card (test payment)' : 'Card'),
    }));
  }

  /** Account → Wallet: saved cards + latest payments. */
  async summary(userId: string) {
    const [payments, cards] = await Promise.all([
      this.payments(userId),
      this.listCards(userId).catch((err) => {
        this.logger.warn(`Could not load saved cards: ${err instanceof Error ? err.message : err}`);
        return [] as SavedCard[];
      }),
    ]);
    return { cardsEnabled: this.cardsEnabled, cardsMode: this.cardsMode, cards, payments };
  }

  // ---- Saved cards (Stripe) ----------------------------------------------------------

  private requireStripe(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException('Saved cards are not available right now.');
    return this.stripe;
  }

  /** The user's Stripe Customer id, creating the customer the first time. */
  async ensureCustomer(userId: string): Promise<string> {
    const stripe = this.requireStripe();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true, email: true, name: true, firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    if (user.stripeCustomerId) return user.stripeCustomerId;
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || undefined;
    const customer = await stripe.customers.create({ email: user.email, name, metadata: { userId } });
    await this.prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  async listCards(userId: string): Promise<SavedCard[]> {
    if (!this.stripe) {
      const rows = await this.prisma.walletCard.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      return rows.map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, expMonth: c.expMonth, expYear: c.expYear, isDefault: c.isDefault }));
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
    if (!user?.stripeCustomerId) return [];
    const [customer, methods] = await Promise.all([
      this.stripe.customers.retrieve(user.stripeCustomerId),
      this.stripe.customers.listPaymentMethods(user.stripeCustomerId, { type: 'card', limit: 20 }),
    ]);
    const defaultId =
      !customer.deleted && customer.invoice_settings?.default_payment_method
        ? String(
            typeof customer.invoice_settings.default_payment_method === 'string'
              ? customer.invoice_settings.default_payment_method
              : customer.invoice_settings.default_payment_method.id,
          )
        : null;
    const cards = methods.data
      .filter((pm) => pm.card)
      .map((pm) => ({
        id: pm.id,
        brand: cardBrandName(pm.card!.brand),
        last4: pm.card!.last4,
        expMonth: pm.card!.exp_month,
        expYear: pm.card!.exp_year,
        isDefault: pm.id === defaultId,
      }));
    // No default chosen yet → the first card acts as the default.
    if (cards.length && !cards.some((c) => c.isDefault)) cards[0].isDefault = true;
    return cards;
  }

  /** Account → Wallet → Add card: Stripe collects the card details (they never reach our server). */
  async createSetupIntent(userId: string) {
    const stripe = this.requireStripe();
    const customer = await this.ensureCustomer(userId);
    const intent = await stripe.setupIntents.create({ customer, allowed_payment_method_types: ['card'], usage: 'off_session', metadata: { userId } });
    return { clientSecret: intent.client_secret };
  }

  /** Test mode: save a card (brand / last 4 / expiry). Same card again just updates it. */
  async addTestCard(userId: string, input: AddTestCardInput) {
    if (this.stripe) throw new BadRequestException('Add cards with the secure card form.');
    const now = new Date();
    if (input.expYear < now.getFullYear() || (input.expYear === now.getFullYear() && input.expMonth < now.getMonth() + 1)) {
      throw new BadRequestException('This card has expired.');
    }
    const cards = await this.prisma.walletCard.findMany({ where: { userId } });
    const same = cards.find((c) => c.brand === input.brand && c.last4 === input.last4 && c.expMonth === input.expMonth && c.expYear === input.expYear);
    if (!same && cards.length >= 10) throw new BadRequestException('You can save up to 10 cards. Remove one first.');
    const makeDefault = input.makeDefault || cards.length === 0 || Boolean(same?.isDefault);
    await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.walletCard.updateMany({ where: { userId }, data: { isDefault: false } });
      if (same) await tx.walletCard.update({ where: { id: same.id }, data: { isDefault: makeDefault } });
      else
        await tx.walletCard.create({
          data: { userId, brand: input.brand, last4: input.last4, expMonth: input.expMonth, expYear: input.expYear, isDefault: makeDefault },
        });
    });
    return { ok: true as const };
  }

  async setDefaultCard(userId: string, cardId: string) {
    if (!this.stripe) {
      await this.findTestCard(userId, cardId);
      await this.prisma.$transaction([
        this.prisma.walletCard.updateMany({ where: { userId }, data: { isDefault: false } }),
        this.prisma.walletCard.update({ where: { id: cardId }, data: { isDefault: true } }),
      ]);
      return { ok: true as const };
    }
    const customer = await this.assertCardBelongs(userId, cardId);
    await this.requireStripe().customers.update(customer, { invoice_settings: { default_payment_method: cardId } });
    return { ok: true as const };
  }

  async removeCard(userId: string, cardId: string) {
    if (!this.stripe) {
      const card = await this.findTestCard(userId, cardId);
      await this.prisma.walletCard.delete({ where: { id: card.id } });
      // The default went away: the oldest remaining card takes over.
      if (card.isDefault) {
        const next = await this.prisma.walletCard.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
        if (next) await this.prisma.walletCard.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      return { ok: true as const };
    }
    await this.assertCardBelongs(userId, cardId);
    await this.requireStripe().paymentMethods.detach(cardId);
    return { ok: true as const };
  }

  private async findTestCard(userId: string, cardId: string) {
    const card = await this.prisma.walletCard.findFirst({ where: { id: cardId, userId } });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  /** Checkout / card actions: the card must be one of this customer's saved cards. Returns the Stripe Customer id. */
  async assertCardBelongs(userId: string, cardId: string): Promise<string> {
    const stripe = this.requireStripe();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
    if (!user?.stripeCustomerId) throw new NotFoundException('Card not found');
    const pm = await stripe.paymentMethods.retrieve(cardId).catch(() => null);
    const owner = pm && (typeof pm.customer === 'string' ? pm.customer : pm.customer?.id);
    if (!pm || owner !== user.stripeCustomerId) throw new NotFoundException('Card not found');
    return user.stripeCustomerId;
  }
}
