import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Prisma, Subscription } from '../generated/prisma/client.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addInterval, intervalText, type SupplyOption } from '../products/supply-options.js';
import {
  commitmentText,
  parseSubscriptionSettingsForSave,
  readSubscriptionSettings,
  SUBSCRIPTION_SETTINGS_KEY,
  type SubscriptionSettings,
} from './subscription-settings.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A Subscribe & Save line of a paid checkout (from CheckoutService.calculatePricing). */
export interface NewSubscriptionLine {
  productId: string;
  productName: string;
  productImage: string;
  option: SupplyOption;
  /** How often it renews — the supply length of the chosen package */
  frequency: { id: string; label: string; interval: 'week' | 'month'; intervalCount: number };
  quantity: number;
  unitPrice: number;
  /** Per-pack price of every renewal (same as the first order, coupon included) */
  renewalUnitPrice: number;
  tax: number;
}

/**
 * Subscribe & Save (docs/SUBSCRIPTIONS.md).
 *
 * Checkout charges the first delivery of every line together (one payment, one order) and saves the
 * card. Then each subscribed line gets a Stripe Subscription whose first renewal is one supply length
 * later (`trial_end`). Every paid renewal invoice creates a normal Order (status Placed → … → Delivered).
 * Each renewal = subscription price × quantity + delivery + tax — never discounted.
 * Customers can cancel once they've had `minOrders` deliveries; admins can cancel any time.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly stripe: Stripe | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly loyalty?: LoyaltyService,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY') ?? process.env.STRIPE_SECRET_KEY ?? '';
    this.stripe = key ? new Stripe(key) : null;
  }

  /** Subscriptions bill automatically, so they need Stripe. */
  get available() {
    return Boolean(this.stripe);
  }

  // ---- Settings (CMS section "subscriptions") ---------------------------------------------

  async settings(): Promise<SubscriptionSettings> {
    const record = await this.prisma.cmsSection.findUnique({ where: { key: SUBSCRIPTION_SETTINGS_KEY } });
    return readSubscriptionSettings(record?.data);
  }

  /** Public: what the product page and checkout need. */
  async publicSettings() {
    const settings = await this.settings();
    return { ...settings, enabled: settings.enabled && this.available, commitment: commitmentText(settings.minOrders) };
  }

  async saveSettings(raw: unknown) {
    const parsed = parseSubscriptionSettingsForSave(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    await this.prisma.cmsSection.upsert({
      where: { key: SUBSCRIPTION_SETTINGS_KEY },
      create: { key: SUBSCRIPTION_SETTINGS_KEY, data: parsed.data as unknown as Prisma.InputJsonValue },
      update: { data: parsed.data as unknown as Prisma.InputJsonValue },
    });
    return parsed.data;
  }

  // ---- Starting subscriptions (after checkout) ----------------------------------------------

  /**
   * Called once the checkout order is paid. Creates our Subscription rows and the Stripe
   * subscriptions (first renewal one supply length from now). Never throws: the customer has paid
   * for the first delivery either way; problems are logged and shown in the dashboard.
   */
  async startFromOrder(input: {
    userId: string;
    order: { id: string; orderNumber: string; customerEmail: string; customerName: string };
    lines: NewSubscriptionLine[];
    shippingMethod: string;
    shippingFee: number;
    shippingAddress: unknown;
    paymentLabel: string;
    stripeCustomerId: string | null;
    paymentMethodId: string | null;
  }) {
    if (!input.lines.length) return [];
    const settings = await this.settings();
    const created: Subscription[] = [];
    for (const line of input.lines) {
      // Every renewal costs what this first order cost (Subscribe & Save + the coupon used), plus delivery and tax.
      const renewalAmount = round2(line.renewalUnitPrice * line.quantity + input.shippingFee + line.tax);
      // The customer chose how often (every week / 2 weeks / month), not the package length.
      const nextRenewalAt = addInterval(new Date(), line.frequency);
      const row = await this.prisma.subscription.create({
        data: {
          userId: input.userId,
          productId: line.productId,
          productName: line.productName,
          productImage: line.productImage,
          optionId: line.option.id,
          optionLabel: line.option.label,
          interval: line.frequency.interval,
          intervalCount: line.frequency.intervalCount,
          quantity: line.quantity,
          unitPrice: line.renewalUnitPrice,
          shippingMethod: input.shippingMethod,
          shippingFee: input.shippingFee,
          tax: line.tax,
          renewalAmount,
          shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
          paymentLabel: input.paymentLabel,
          ordersCount: 1,
          minOrders: settings.minOrders,
          firstOrderId: input.order.id,
          nextRenewalAt,
          stripeCustomerId: input.stripeCustomerId,
        },
      });

      try {
        if (!this.stripe || !input.stripeCustomerId || !input.paymentMethodId) {
          throw new Error('No Stripe customer / saved card for the renewals');
        }
        const stripeProduct = await this.stripeProductFor(line.productId, line.productName);
        const sub = await this.stripe.subscriptions.create({
          customer: input.stripeCustomerId,
          default_payment_method: input.paymentMethodId,
          items: [
            {
              price_data: {
                currency: 'gbp',
                product: stripeProduct,
                unit_amount: Math.round(renewalAmount * 100),
                recurring: { interval: line.frequency.interval, interval_count: line.frequency.intervalCount },
              },
              quantity: 1,
            },
          ],
          // The first delivery was paid at checkout: the first renewal is one frequency away.
          trial_end: Math.floor(nextRenewalAt.getTime() / 1000),
          proration_behavior: 'none',
          description: `${line.productName} — ${line.option.label} × ${line.quantity}, ${line.frequency.label.toLowerCase()} (order #${input.order.orderNumber})`,
          metadata: { subscriptionId: row.id, userId: input.userId, firstOrder: input.order.orderNumber },
        });
        created.push(await this.prisma.subscription.update({ where: { id: row.id }, data: { stripeSubscriptionId: sub.id } }));
        void this.mail
          ?.sendSubscriptionEmail({
            kind: 'started',
            to: input.order.customerEmail,
            name: input.order.customerName,
            productName: line.productName,
            optionLabel: line.option.label,
            frequency: line.frequency.label.toLowerCase(),
            renewalAmount,
            nextRenewalAt,
            minOrders: settings.minOrders,
          })
          .catch(() => undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Could not start the subscription for order #${input.order.orderNumber} (${line.productName}): ${message}`);
        created.push(
          await this.prisma.subscription.update({
            where: { id: row.id },
            data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Could not start: ${message}`.slice(0, 300), nextRenewalAt: null },
          }),
        );
      }
    }
    return created;
  }

  /** One Stripe Product per Slimza product (created the first time it is subscribed to). */
  private async stripeProductFor(productId: string, name: string): Promise<string> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { stripeProductId: true } });
    if (product?.stripeProductId) return product.stripeProductId;
    const created = await this.stripe!.products.create({ name, metadata: { productId } });
    await this.prisma.product.update({ where: { id: productId }, data: { stripeProductId: created.id } }).catch(() => undefined);
    return created.id;
  }

  // ---- Renewals (Stripe webhook / "renew now") -----------------------------------------------

  /** invoice.paid for a subscription renewal → a new order. Once per invoice. */
  async recordRenewal(invoice: Stripe.Invoice) {
    if (invoice.billing_reason === 'subscription_create' || !invoice.amount_paid) return null; // the £0 trial start
    const stripeSubId = this.subscriptionIdOf(invoice);
    if (!stripeSubId) return null;
    const sub = await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId: stripeSubId }, include: { user: true } });
    if (!sub) return null;
    const existing = await this.prisma.order.findUnique({ where: { stripeInvoiceId: invoice.id } });
    if (existing) return existing;

    const address = (sub.shippingAddress ?? {}) as Record<string, string | undefined>;
    const sequence = sub.ordersCount + 1;
    const order = await this.prisma.order.create({
      data: {
        orderNumber: await this.newOrderNumber(),
        userId: sub.userId,
        customerEmail: (address.email || sub.user.email).toLowerCase(),
        customerName: address.name || sub.user.name || 'Customer',
        customerPhone: address.phone || '',
        shippingAddress: sub.shippingAddress as Prisma.InputJsonValue,
        shippingMethod: sub.shippingMethod,
        shippingFee: sub.shippingFee,
        subtotal: round2(sub.unitPrice * sub.quantity),
        tax: sub.tax,
        total: round2(invoice.amount_paid / 100),
        currency: 'gbp',
        paymentStatus: 'PAID',
        paymentMode: 'stripe',
        paymentLabel: sub.paymentLabel,
        subscriptionId: sub.id,
        subscriptionSequence: sequence,
        stripeInvoiceId: invoice.id,
        items: {
          create: [
            {
              productId: sub.productId ?? sub.optionId,
              productName: sub.productName,
              productImage: sub.productImage,
              sizeLabel: sub.optionLabel,
              planLabel: `Subscribe & Save · delivery ${sequence}`,
              quantity: sub.quantity,
              unitPrice: sub.unitPrice,
              totalPrice: round2(sub.unitPrice * sub.quantity),
            },
          ],
        },
      },
      include: { items: true },
    });

    const nextRenewalAt = this.periodEnd(invoice) ?? addInterval(new Date(), { interval: sub.interval as 'week' | 'month', intervalCount: sub.intervalCount });
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { ordersCount: sequence, status: 'ACTIVE', nextRenewalAt } });
    this.logger.log(`Subscription ${sub.id}: renewal order #${order.orderNumber} (delivery ${sequence}).`);

    if (this.loyalty) {
      const pointsEarned = await this.loyalty.pointsForOrder(sub.userId, round2(sub.unitPrice * sub.quantity)).catch(() => 0);
      if (pointsEarned) {
        await this.prisma.order.update({ where: { id: order.id }, data: { pointsEarned } }).catch(() => undefined);
        await this.loyalty
          .recordOrder({ orderId: order.id, orderNumber: order.orderNumber, redeemUserId: null, pointsRedeemed: 0, earnUserId: sub.userId, pointsEarned, paid: true })
          .catch(() => undefined);
      }
    }
    void this.mail
      ?.sendOrderConfirmationEmails({
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        status: order.status,
        paymentStatus: order.paymentStatus,
        subtotal: order.subtotal,
        discount: 0,
        shippingFee: order.shippingFee,
        shippingMethod: order.shippingMethod,
        tax: order.tax,
        total: order.total,
        shippingAddress: address,
        items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice, sizeLabel: i.sizeLabel, planLabel: i.planLabel })),
      })
      .catch(() => undefined);
    return order;
  }

  /** invoice.payment_failed → Past due (Stripe keeps retrying) + email with a link to pay. */
  async markPaymentFailed(invoice: Stripe.Invoice) {
    const stripeSubId = this.subscriptionIdOf(invoice);
    if (!stripeSubId) return;
    const sub = await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId: stripeSubId }, include: { user: true } });
    if (!sub || sub.status === 'CANCELLED') return;
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
    void this.mail
      ?.sendSubscriptionEmail({
        kind: 'payment_failed',
        to: sub.user.email,
        name: sub.user.name || '',
        productName: sub.productName,
        optionLabel: sub.optionLabel,
        frequency: intervalText({ interval: sub.interval as 'week' | 'month', intervalCount: sub.intervalCount }),
        renewalAmount: sub.renewalAmount,
        payUrl: invoice.hosted_invoice_url ?? null,
      })
      .catch(() => undefined);
  }

  /** customer.subscription.deleted (Stripe gave up retrying, or cancelled elsewhere). */
  async markCancelled(stripeSubscriptionId: string, reason = 'Cancelled in Stripe') {
    const sub = await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId } });
    if (!sub || sub.status === 'CANCELLED') return;
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, nextRenewalAt: null },
    });
  }

  // ---- Customer --------------------------------------------------------------------------

  async listMine(userId: string) {
    const rows = await this.prisma.subscription.findMany({ where: { userId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
    return rows.map((s) => this.toView(s));
  }

  async cancelMine(userId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, userId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status === 'CANCELLED') return this.toView(sub);
    if (sub.ordersCount < sub.minOrders) {
      const left = sub.minOrders - sub.ordersCount;
      throw new ForbiddenException(
        `Your plan has a minimum of ${sub.minOrders} deliveries. You can cancel after ${left} more ${left === 1 ? 'delivery' : 'deliveries'}.`,
      );
    }
    return this.toView(await this.cancel(sub, 'Cancelled by the customer'));
  }

  /** Pause: no renewals are charged (or delivered) until the customer resumes. */
  async pauseMine(userId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, userId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    return this.toView(await this.setPaused(sub, true));
  }

  async resumeMine(userId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, userId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    return this.toView(await this.setPaused(sub, false));
  }

  // ---- Admin -----------------------------------------------------------------------------

  async adminSetPaused(id: string, paused: boolean) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    return this.toView(await this.setPaused(sub, paused));
  }

  async adminList(status?: string) {
    const rows = await this.prisma.subscription.findMany({
      where: status ? { status: status as Subscription['status'] } : {},
      orderBy: [{ status: 'asc' }, { nextRenewalAt: 'asc' }, { createdAt: 'desc' }],
      include: { user: { select: { email: true, name: true } } },
      take: 200,
    });
    return rows.map((s) => ({ ...this.toView(s), customerEmail: s.user.email, customerName: s.user.name }));
  }

  async adminCancel(id: string, reason?: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status === 'CANCELLED') return this.toView(sub);
    return this.toView(await this.cancel(sub, reason?.trim() || 'Cancelled by Slimza'));
  }

  /**
   * Charge and create the next delivery now (support / testing). Moves the billing date to today;
   * the following renewals continue one supply length after it.
   */
  async adminRenewNow(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status === 'CANCELLED' || sub.status === 'PAUSED' || !sub.stripeSubscriptionId) throw new BadRequestException('Only active subscriptions can be renewed.');
    if (!this.stripe) throw new BadRequestException('Stripe is not configured.');
    const current = await this.stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    await this.stripe.subscriptions.update(
      sub.stripeSubscriptionId,
      (current.status === 'trialing'
        ? { trial_end: 'now', proration_behavior: 'none' }
        : { billing_cycle_anchor: 'now', proration_behavior: 'none' }) as Stripe.SubscriptionUpdateParams,
    );
    // Record it straight away (the webhook does the same; recordRenewal runs once per invoice).
    const invoices = await this.stripe.invoices.list({ subscription: sub.stripeSubscriptionId, limit: 1 });
    const invoice = invoices.data[0];
    if (invoice?.status === 'paid') {
      const order = await this.recordRenewal(invoice);
      return { ok: true as const, orderNumber: order?.orderNumber ?? null };
    }
    if (invoice) await this.markPaymentFailed(invoice);
    return { ok: false as const, orderNumber: null, message: 'The renewal payment did not go through; the customer has been emailed.' };
  }

  // ---- Helpers ---------------------------------------------------------------------------

  /**
   * Stripe pause_collection "void": renewal invoices while paused are voided (nothing charged, no
   * order). Resuming continues on the normal schedule from the next renewal date.
   */
  private async setPaused(sub: Subscription, paused: boolean) {
    if (sub.status === 'CANCELLED') throw new BadRequestException('This subscription is cancelled.');
    if (paused === (sub.status === 'PAUSED')) return sub;
    if (sub.stripeSubscriptionId && this.stripe) {
      await this.stripe.subscriptions
        .update(sub.stripeSubscriptionId, { pause_collection: paused ? { behavior: 'void' } : '' } as Stripe.SubscriptionUpdateParams)
        .catch((err) => {
          throw new BadRequestException(`Stripe: ${err?.message ?? err}`);
        });
    }
    let nextRenewalAt = sub.nextRenewalAt;
    if (!paused && nextRenewalAt) {
      // Skipped renewals while paused: the next one is the first renewal date still ahead.
      const freq = { interval: sub.interval as 'week' | 'month', intervalCount: sub.intervalCount };
      while (nextRenewalAt < new Date()) nextRenewalAt = addInterval(nextRenewalAt, freq);
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: paused ? 'PAUSED' : 'ACTIVE', nextRenewalAt },
    });
  }

  private async cancel(sub: Subscription, reason: string) {
    if (sub.stripeSubscriptionId && this.stripe) {
      await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId).catch((err) => {
        // Already cancelled in Stripe is fine; anything else must stop the cancel.
        if (!String(err?.message ?? '').toLowerCase().includes('canceled')) throw new BadRequestException(`Stripe: ${err?.message ?? err}`);
      });
    }
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.slice(0, 300), nextRenewalAt: null },
      include: { user: true },
    });
    void this.mail
      ?.sendSubscriptionEmail({
        kind: 'cancelled',
        to: updated.user.email,
        name: updated.user.name || '',
        productName: sub.productName,
        optionLabel: sub.optionLabel,
        frequency: intervalText({ interval: sub.interval as 'week' | 'month', intervalCount: sub.intervalCount }),
        renewalAmount: sub.renewalAmount,
      })
      .catch(() => undefined);
    return updated;
  }

  private toView(s: Subscription) {
    const frequency = intervalText({ interval: s.interval as 'week' | 'month', intervalCount: s.intervalCount });
    return {
      id: s.id,
      status: s.status,
      productId: s.productId,
      productName: s.productName,
      productImage: s.productImage,
      optionLabel: s.optionLabel,
      frequency,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      shippingFee: s.shippingFee,
      tax: s.tax,
      renewalAmount: s.renewalAmount,
      paymentLabel: s.paymentLabel,
      ordersCount: s.ordersCount,
      minOrders: s.minOrders,
      canCancel: s.status !== 'CANCELLED' && s.ordersCount >= s.minOrders,
      canPause: s.status === 'ACTIVE' || s.status === 'PAST_DUE',
      canResume: s.status === 'PAUSED',
      nextRenewalAt: s.nextRenewalAt,
      cancelledAt: s.cancelledAt,
      cancelReason: s.cancelReason,
      createdAt: s.createdAt,
    };
  }

  private subscriptionIdOf(invoice: Stripe.Invoice): string | null {
    const ref = invoice.parent?.subscription_details?.subscription;
    return typeof ref === 'string' ? ref : (ref?.id ?? null);
  }

  /** When the period this invoice paid for ends = the next renewal. */
  private periodEnd(invoice: Stripe.Invoice): Date | null {
    const end = invoice.lines?.data?.[0]?.period?.end;
    return end ? new Date(end * 1000) : null;
  }

  private async newOrderNumber() {
    for (let i = 0; i < 6; i++) {
      const candidate = `SLZ-${Math.floor(10000 + Math.random() * 89999)}`;
      if (!(await this.prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } }))) return candidate;
    }
    return `SLZ-${Date.now().toString().slice(-7)}`;
  }
}
