import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import {
  archiveWhere,
  assertAllArchivedBeforeDelete,
  assertArchivedBeforeDelete,
  type ArchiveFilter,
} from '../common/archive/archive.js';
import {
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  UserRole,
} from '../generated/prisma/enums.js';
import { evaluateCouponStatus } from '../coupons/coupons.service.js';
import { ACCOUNT_ACCESS_SELECT, assertAccountUsable } from '../users/account-access.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cardBrandName, planWalletUse } from '../wallet/wallet-rules.js';
import { WalletService } from '../wallet/wallet.service.js';
import type {
  CartBundleInput,
  CartLineInput,
  ConfirmOrderInput,
  CreatePaymentIntentInput,
  ProcessRefundInput,
} from './checkout.schemas.js';
import {
  BUNDLE_CMS_KEY,
  DEFAULT_BUNDLE_CONFIG,
  readBundleConfig,
  type BundleConfig,
} from '../bundle/bundle-config.js';
import { bundleRuleError, priceBundle, type BundleLine } from '../bundle/bundle-pricing.js';
import {
  BACKEND_CATALOG,
  SHIPPING_METHODS,
  SIZE_TABLES,
  SUPPLY_PLAN_DISCOUNTS,
  round2,
} from './pricing.constants.js';

export interface CalculatedPricing {
  subtotal: number;
  discount: number;
  bundleSavings: number;
  bundleSpend: number;
  bundleReward: number;
  /** Loyalty points spent on this order and the £ they took off. */
  pointsRedeemed: number;
  pointsDiscount: number;
  /** Product spend that earns points (after every discount, excluding delivery). */
  pointsEligibleSpend: number;
  shipping: number;
  shippingMethod: { id: string; name: string; fee: number; eta: string };
  /** Order value after every discount (before store credit). Saved as Order.total. */
  total: number;
  /** Store credit used (signed-in customers who chose to use it). */
  walletUsed: number;
  /** What the card is charged: total − walletUsed. */
  amountDue: number;
  /** amountDue in pence (Stripe). */
  totalInPence: number;
  promoCode: string | null;
  lineItems: Array<{
    productId: string;
    productName: string;
    productImage: string;
    sizeLabel: string;
    planLabel: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    isBundle: boolean;
    bundleData?: Record<string, unknown>;
  }>;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly stripe: Stripe | null = null;
  private readonly webhookSecret: string;
  private readonly publishableKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly loyaltyService?: LoyaltyService,
    @Optional() private readonly walletService?: WalletService,
  ) {
    const secretKey =
      this.configService.get<string>('STRIPE_SECRET_KEY') ??
      process.env.STRIPE_SECRET_KEY ??
      '';

    this.publishableKey =
      this.configService.get<string>('STRIPE_PUBLISHABLE_KEY') ??
      process.env.STRIPE_PUBLISHABLE_KEY ??
      '';

    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ??
      process.env.STRIPE_WEBHOOK_SECRET ??
      '';

    if (secretKey) {
      this.stripe = new Stripe(secretKey);
      this.logger.log('Stripe client initialized successfully.');
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set. Stripe calls will operate in demo mode.');
    }
  }

  getPublishableKey(): string {
    return this.publishableKey;
  }

  async calculatePricing(
    input: {
      lines?: CartLineInput[];
      bundles?: CartBundleInput[];
      promoCode?: string | null;
      shippingMethodId?: string;
      /** Loyalty points the signed-in customer wants to use. */
      pointsToRedeem?: number;
      /** Required to use points / store credit. */
      userId?: string | null;
      /** Pay what store credit covers (signed-in customers). */
      useWallet?: boolean;
    },
    options?: { strictPromo?: boolean; strictPoints?: boolean },
  ): Promise<CalculatedPricing> {
    const lines = input.lines ?? [];
    const bundles = input.bundles ?? [];
    const lineItems: CalculatedPricing['lineItems'] = [];

    let rawLinesSubtotal = 0;

    for (const line of lines) {
      if (!line.qty || line.qty <= 0) continue;
      let product = BACKEND_CATALOG[line.productId];
      let name = product ? product.name : `Product ${line.productId}`;
      let basePrice = product ? product.price : 25;
      let image = product?.image ?? '';
      const sizeType = product ? product.sizeType : 'powder';

      if (!product && this.prisma.product?.findFirst) {
        const dbProduct = await this.prisma.product.findFirst({
          where: { OR: [{ id: line.productId }, { slug: line.productId }] },
        });
        // Archived products are hidden from the shop and cannot be bought,
        // even if a stale basket still references them.
        if (dbProduct?.archivedAt) {
          throw new BadRequestException(
            `"${dbProduct.name}" is no longer available. Please remove it from your basket.`,
          );
        }
        if (dbProduct) {
          name = dbProduct.name;
          basePrice = dbProduct.price;
          image = dbProduct.image ?? '';
        }
      }

      const sizeTable = SIZE_TABLES[sizeType];
      const sizeIndex =
        line.sizeIndex !== undefined && sizeTable[line.sizeIndex]
          ? line.sizeIndex
          : 0;
      const sizeOption = sizeTable[sizeIndex] ?? sizeTable[0];
      const plan =
        line.months && SUPPLY_PLAN_DISCOUNTS[line.months]
          ? SUPPLY_PLAN_DISCOUNTS[line.months]
          : SUPPLY_PLAN_DISCOUNTS[1];

      const unitPrice = round2(basePrice * sizeOption.multiplier * (1 - plan.discount));
      const lineTotal = round2(unitPrice * line.qty);
      rawLinesSubtotal += lineTotal;

      lineItems.push({
        productId: line.productId,
        productName: name,
        productImage: image,
        sizeLabel: sizeOption.label,
        planLabel: plan.label,
        quantity: line.qty,
        unitPrice,
        totalPrice: lineTotal,
        isBundle: false,
      });
    }

    // ---- Bundles: rules + prices from the dashboard (CMS section "bundle") ----
    const bundlePricing = await this.priceBundles(bundles);
    lineItems.push(...bundlePricing.lineItems);
    const { config: bundleConfig, bundleSpend, bundleSavings } = bundlePricing;

    // Bundle totals are already after the tier discount.
    const subtotal = round2(rawLinesSubtotal + bundleSpend);

    const normalizedPromo = input.promoCode
      ? input.promoCode.trim().toUpperCase()
      : null;

    let promoRate = 0;
    let appliedPromoCode: string | null = null;

    if (normalizedPromo) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: normalizedPromo },
      });

      if (!coupon) {
        if (options?.strictPromo) {
          throw new BadRequestException('Invalid coupon code.');
        }
      } else {
        const evaluation = evaluateCouponStatus(coupon);
        if (!evaluation.isValid) {
          if (options?.strictPromo) {
            throw new BadRequestException(
              evaluation.reason ?? 'This coupon has expired or is no longer valid.',
            );
          }
        } else {
          promoRate = Math.min(1, Math.max(0, coupon.discountPercent / 100));
          appliedPromoCode = coupon.code;
        }
      }
    }

    // "Allow coupons on bundles" off → the coupon only reduces the non-bundle items,
    // and a basket of only bundles can't use a coupon at all (refused at the payment step).
    const bundlesOnly = bundleSpend > 0 && lineItems.every((l) => l.isBundle);
    if (appliedPromoCode && !bundleConfig.discounts.allowCoupons && bundlesOnly) {
      if (options?.strictPromo) throw new BadRequestException("Coupon codes can't be used on bundles.");
      promoRate = 0;
      appliedPromoCode = null;
    }
    const couponBase = bundleConfig.discounts.allowCoupons ? subtotal : round2(rawLinesSubtotal);
    const discount = round2(couponBase * promoRate);

    const { spendReward } = bundleConfig;
    const bundleReward =
      spendReward.enabled && bundleSpend > 0 && bundleSpend >= spendReward.threshold
        ? spendReward.amount
        : 0;

    const selectedShipping =
      input.shippingMethodId && SHIPPING_METHODS[input.shippingMethodId]
        ? SHIPPING_METHODS[input.shippingMethodId]
        : SHIPPING_METHODS['uk-standard'];

    const shipping =
      lineItems.length > 0 ? selectedShipping.fee : 0;

    // ---- Loyalty points (Slimza Rewards): pay for products, never for delivery ----
    const productsAfterDiscounts = Math.max(0, round2(subtotal - discount - bundleReward));
    const points = await this.planPoints(input.pointsToRedeem ?? 0, input.userId ?? null, productsAfterDiscounts, options?.strictPoints);

    const total = Math.max(
      0,
      round2(subtotal - discount - bundleReward - points.discount + shipping),
    );
    // ---- Store credit (wallet): money, so it can pay for anything, delivery included ----
    const walletBalance =
      input.useWallet && input.userId && this.walletService ? await this.walletService.balance(input.userId) : 0;
    const walletUsed = planWalletUse(walletBalance, total, Boolean(input.useWallet && input.userId));
    const amountDue = Math.max(0, round2(total - walletUsed));
    const totalInPence = Math.round(amountDue * 100);

    return {
      subtotal,
      discount,
      bundleSavings,
      bundleSpend,
      bundleReward,
      pointsRedeemed: points.points,
      pointsDiscount: points.discount,
      pointsEligibleSpend: Math.max(0, round2(productsAfterDiscounts - points.discount)),
      shipping,
      shippingMethod: selectedShipping,
      total,
      walletUsed,
      amountDue,
      totalInPence,
      promoCode: appliedPromoCode,
      lineItems,
    };
  }

  /**
   * How many loyalty points this order can use. Points need a signed-in customer.
   * strict (payment step): explain why the request can't be honoured (400).
   * lenient (order confirmation): use what is possible, never fail a paid order.
   */
  private async planPoints(requested: number, userId: string | null, eligibleAmount: number, strict = false) {
    const none = { points: 0, discount: 0 };
    if (!requested || requested <= 0) return none;
    if (!userId || !this.loyaltyService) {
      if (strict) throw new BadRequestException('Sign in to use your loyalty points.');
      return none;
    }
    const { config, balance } = await this.loyaltyService.getRedeemContext(userId);
    const plan = this.loyaltyService.planRedemption(config, requested, balance, eligibleAmount);
    if (strict && plan.points < requested) {
      const messages: Record<string, string> = {
        disabled: `${config.programName} is paused, so points can't be used right now.`,
        balance: `You have ${balance} points available.`,
        minimum: `You can use points from ${config.redeem.minPoints} points.`,
        order: 'That is more points than this order can use.',
      };
      throw new BadRequestException(messages[plan.limitedBy ?? 'order']);
    }
    return { points: plan.points, discount: plan.discount };
  }

  /** Reads the dashboard's bundle settings (CMS section "bundle"), falling back to the defaults. */
  private async loadBundleConfig(): Promise<BundleConfig> {
    if (!this.prisma.cmsSection?.findUnique) return DEFAULT_BUNDLE_CONFIG;
    const record = await this.prisma.cmsSection.findUnique({ where: { key: BUNDLE_CMS_KEY } });
    return readBundleConfig(record?.data);
  }

  /**
   * Prices "make your own bundle" entries against the database, never the
   * browser's numbers. Each bundle must satisfy the dashboard rules
   * (min/max items, per-category limit, allowed categories) or checkout fails
   * with 400 and a message the customer can act on.
   */
  private async priceBundles(bundles: CartBundleInput[]): Promise<{
    config: BundleConfig;
    bundleSpend: number;
    bundleSavings: number;
    lineItems: CalculatedPricing['lineItems'];
  }> {
    const config = await this.loadBundleConfig();
    const active = bundles.filter((b) => b.qty > 0 && Array.isArray(b.items) && b.items.length > 0);
    if (active.length === 0) return { config, bundleSpend: 0, bundleSavings: 0, lineItems: [] };

    if (!config.enabled) {
      throw new BadRequestException(
        'Bundles are not available right now. Please remove the bundle from your basket.',
      );
    }

    const ids = [...new Set(active.flatMap((b) => b.items.map((i) => i.productId)))];
    const products = this.prisma.product?.findMany
      ? await this.prisma.product.findMany({ where: { id: { in: ids } } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const categoryName = await this.categoryNameResolver();

    let bundleSpend = 0;
    let bundleSavings = 0;
    const lineItems: CalculatedPricing['lineItems'] = [];

    for (const b of active) {
      const lines: BundleLine[] = b.items.map((item) => {
        const p = byId.get(item.productId);
        if (!p || p.archivedAt || p.publishStatus !== 'published') {
          throw new BadRequestException(
            `${p ? `"${p.name}"` : 'A product in your bundle'} is no longer available. Please rebuild your bundle.`,
          );
        }
        if (!p.unlimitedStock && p.stockStatus === 'Out of Stock') {
          throw new BadRequestException(`"${p.name}" is out of stock. Please rebuild your bundle.`);
        }
        return {
          product: {
            id: p.id,
            name: p.name,
            image: p.image ?? '',
            price: p.price,
            originalPrice: p.originalPrice ?? null,
            category: p.category,
          },
          qty: item.qty ?? 1,
        };
      });

      const ruleError = bundleRuleError(config, lines, categoryName);
      if (ruleError) throw new BadRequestException(ruleError);

      const priced = priceBundle(config, lines);
      const bundleTotal = round2(priced.total * b.qty);
      bundleSpend += bundleTotal;
      bundleSavings += round2(priced.discount * b.qty);

      lineItems.push({
        productId: `bundle-${priced.items.map((i) => i.productId).join('+')}`,
        productName: `Custom Bundle (${priced.items.map((i) => i.name).join(', ')})`,
        productImage: priced.items[0]?.image ?? '',
        sizeLabel: 'Custom Bundle',
        planLabel: `${priced.units} items${priced.percent ? ` · ${priced.percent}% off` : ''}`,
        quantity: b.qty,
        unitPrice: priced.total,
        totalPrice: bundleTotal,
        isBundle: true,
        bundleData: {
          items: priced.items,
          subtotal: priced.subtotal,
          discountPercent: priced.percent,
          discount: priced.discount,
          total: priced.total,
        },
      });
    }

    return { config, bundleSpend: round2(bundleSpend), bundleSavings: round2(bundleSavings), lineItems };
  }

  /** slug → category display name (from the CMS categories section), for error messages. */
  private async categoryNameResolver(): Promise<(slug: string) => string> {
    const record = this.prisma.cmsSection?.findUnique
      ? await this.prisma.cmsSection.findUnique({ where: { key: 'categories' } })
      : null;
    const list = Array.isArray(record?.data) ? (record.data as Array<{ slug?: unknown; name?: unknown }>) : [];
    const names = new Map(
      list
        .filter((c) => typeof c.slug === 'string' && typeof c.name === 'string')
        .map((c) => [c.slug as string, c.name as string]),
    );
    return (slug) => names.get(slug) ?? slug;
  }

  /**
   * Who may buy:
   *  - not an admin (by role or by the order email), and
   *  - not a suspended / archived account (src/users/account-access.ts),
   *    checked by the signed-in user AND by the order email, so a suspended
   *    customer can't sign out and buy "as a guest" with the same email.
   * Runs before the PaymentIntent is created and again before the order is saved.
   */
  private async assertPurchaserCanBuy(
    email?: string,
    userRole?: UserRole,
    userId?: string,
  ): Promise<void> {
    if (userRole === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Admin accounts are not allowed to purchase products. Please sign in with a customer account.',
      );
    }

    if (!this.prisma.user?.findUnique) return;

    if (userId) {
      const buyer = await this.prisma.user.findUnique({
        where: { id: userId },
        select: ACCOUNT_ACCESS_SELECT,
      });
      if (buyer) assertAccountUsable(buyer);
    }

    const normalizedEmail = email?.trim().toLowerCase();
    if (normalizedEmail) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { role: true, ...ACCOUNT_ACCESS_SELECT },
      });
      if (existingUser?.role === UserRole.ADMIN) {
        throw new ForbiddenException(
          'Admin accounts are not allowed to purchase products. Please use a customer account.',
        );
      }
      if (existingUser) assertAccountUsable(existingUser);
    }
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    userId?: string,
    userRole?: UserRole,
  ): Promise<{
    /** wallet = store credit covers everything: no card payment, confirm with paymentMode "wallet". */
    mode: 'stripe' | 'demo' | 'wallet';
    clientSecret: string | null;
    paymentIntentId: string | null;
    pricing: {
      total: number;
      walletUsed: number;
      amountDue: number;
      shipping: number;
      discount: number;
      pointsRedeemed: number;
      pointsDiscount: number;
      shippingMethod: { id: string; name: string; fee: number; eta: string };
    };
  }> {
    await this.assertPurchaserCanBuy(input.shippingAddress?.email, userRole, userId);

    const pricing = await this.calculatePricing(
      {
        lines: input.lines,
        bundles: input.bundles,
        promoCode: input.promoCode,
        shippingMethodId: input.shippingMethodId,
        pointsToRedeem: input.pointsToRedeem,
        userId,
        useWallet: input.useWallet,
      },
      { strictPromo: true, strictPoints: true },
    );

    if (pricing.lineItems.length === 0 || pricing.total <= 0) {
      throw new BadRequestException('Shopping basket is empty or has a total of zero.');
    }

    const pricingOut = {
      total: pricing.total,
      walletUsed: pricing.walletUsed,
      amountDue: pricing.amountDue,
      shipping: pricing.shipping,
      discount: pricing.discount,
      pointsRedeemed: pricing.pointsRedeemed,
      pointsDiscount: pricing.pointsDiscount,
      shippingMethod: pricing.shippingMethod,
    };

    // Store credit pays for everything: nothing to charge.
    if (pricing.amountDue <= 0 && pricing.walletUsed > 0) {
      return { mode: 'wallet', clientSecret: null, paymentIntentId: null, pricing: pricingOut };
    }

    if (!this.stripe) {
      this.logger.warn('Stripe secret key is not set. Falling back to demo mode.');
      return { mode: 'demo', clientSecret: null, paymentIntentId: null, pricing: pricingOut };
    }

    // Saved cards (Account → Wallet): pay with one, or save the new card for next time.
    let customer: string | undefined;
    let paymentMethod: string | undefined;
    if (userId && this.walletService?.cardsEnabled) {
      if (input.savedCardId) {
        customer = await this.walletService.assertCardBelongs(userId, input.savedCardId);
        paymentMethod = input.savedCardId;
      } else if (input.saveCard) {
        customer = await this.walletService.ensureCustomer(userId);
      }
    }

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: pricing.totalInPence,
        currency: 'gbp',
        automatic_payment_methods: {
          enabled: true,
        },
        ...(customer && { customer }),
        ...(paymentMethod && { payment_method: paymentMethod }),
        ...(customer && !paymentMethod && input.saveCard && { setup_future_usage: 'off_session' as const }),
        receipt_email: input.shippingAddress.email,
        metadata: {
          customerName: input.shippingAddress.name,
          customerEmail: input.shippingAddress.email,
          customerPhone: input.shippingAddress.phone,
          shippingMethod: pricing.shippingMethod.id,
          promoCode: pricing.promoCode ?? '',
          userId: userId ?? '',
          pointsRedeemed: String(pricing.pointsRedeemed),
          walletUsed: String(pricing.walletUsed),
        },
      });

      return {
        mode: 'stripe',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        pricing: pricingOut,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to create payment session';
      this.logger.error(`Stripe paymentIntent error: ${message}`, err);
      throw new InternalServerErrorException(
        'Payment setup failed. Please try again or choose another payment method.',
      );
    }
  }

  async confirmOrder(
    input: ConfirmOrderInput,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.assertPurchaserCanBuy(input.shippingAddress?.email, userRole, userId);

    const pricing = await this.calculatePricing(
      {
        lines: input.lines,
        bundles: input.bundles,
        promoCode: input.promoCode,
        shippingMethodId: input.shippingMethodId,
        pointsToRedeem: input.pointsToRedeem,
        userId,
        useWallet: input.useWallet,
      },
      { strictPromo: input.paymentMode !== 'stripe', strictPoints: input.paymentMode !== 'stripe' },
    );

    // Paid fully with store credit: there must be credit, and it must cover the whole order.
    if (input.paymentMode === 'wallet') {
      if (!userId) throw new BadRequestException('Sign in to pay with store credit.');
      if (pricing.walletUsed <= 0 || pricing.amountDue > 0) {
        throw new BadRequestException('Your store credit does not cover this order. Please pay the rest by card.');
      }
    }

    // Check if an order already exists for this paymentIntentId
    if (input.paymentIntentId) {
      const existing = await this.prisma.order.findUnique({
        where: { paymentIntentId: input.paymentIntentId },
        include: { items: true },
      });
      if (existing) {
        return existing;
      }
    }

    let paymentStatus: PaymentStatus = PaymentStatus.PENDING;
    // Every new order starts as Placed; admins move it to Processing → Shipped → Delivered.
    const orderStatus: OrderStatus = OrderStatus.PLACED;
    let stripeChargeId: string | null = null;
    let cardLabel: string | null = null;

    if (input.paymentIntentId && this.stripe) {
      try {
        const intent = await this.stripe.paymentIntents.retrieve(input.paymentIntentId, {
          expand: ['payment_method'],
        });
        // "Visa •••• 4242" for the customer's wallet / receipts.
        const pm = intent.payment_method;
        if (pm && typeof pm !== 'string' && pm.card) {
          cardLabel = `${cardBrandName(pm.card.brand)} •••• ${pm.card.last4}`;
        }
        if (intent.status === 'succeeded') {
          paymentStatus = PaymentStatus.PAID;
          if (typeof intent.latest_charge === 'string') {
            stripeChargeId = intent.latest_charge;
          }
        } else if (intent.status === 'processing') {
          paymentStatus = PaymentStatus.PENDING;
        } else {
          paymentStatus = PaymentStatus.PENDING;
        }
      } catch (err) {
        this.logger.warn(
          `Could not verify PaymentIntent ${input.paymentIntentId} with Stripe: ${err instanceof Error ? err.message : ''}`,
        );
        paymentStatus = PaymentStatus.PAID;
      }
    } else {
      paymentStatus = PaymentStatus.PAID;
    }

    // Generate unique order number (e.g. SLZ-54219)
    let orderNumber = `SLZ-${Math.floor(10000 + Math.random() * 89999)}`;
    for (let attempts = 0; attempts < 5; attempts++) {
      const conflict = await this.prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (!conflict) break;
      orderNumber = `SLZ-${Math.floor(10000 + Math.random() * 89999)}`;
    }

    // Determine user ID: from argument or by looking up matching email
    let finalUserId: string | null = userId ?? null;
    if (!finalUserId && input.shippingAddress.email) {
      const matchingUser = await this.prisma.user.findUnique({
        where: { email: input.shippingAddress.email.toLowerCase().trim() },
        select: { id: true },
      });
      if (matchingUser) {
        finalUserId = matchingUser.id;
      }
    }

    const pointsEarned = this.loyaltyService
      ? await this.loyaltyService.pointsForOrder(finalUserId, pricing.pointsEligibleSpend)
      : 0;

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        userId: finalUserId,
        customerEmail: input.shippingAddress.email.toLowerCase().trim(),
        customerName: input.shippingAddress.name.trim(),
        customerPhone: input.shippingAddress.phone.trim(),
        shippingAddress: input.shippingAddress as any,
        shippingMethod: pricing.shippingMethod.id,
        shippingFee: pricing.shipping,
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        bundleSavings: pricing.bundleSavings,
        bundleReward: pricing.bundleReward,
        pointsRedeemed: pricing.pointsRedeemed,
        pointsDiscount: pricing.pointsDiscount,
        pointsEarned,
        promoCode: pricing.promoCode,
        total: pricing.total,
        walletUsed: pricing.walletUsed,
        currency: 'gbp',
        status: orderStatus,
        paymentStatus,
        paymentMode: input.paymentMode ?? 'stripe',
        paymentLabel: this.paymentLabelFor(input.paymentMode ?? 'stripe', pricing.walletUsed, cardLabel ?? input.paymentLabel),
        paymentIntentId: input.paymentIntentId ?? null,
        stripeChargeId,
        items: {
          create: pricing.lineItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            productImage: item.productImage,
            sizeLabel: item.sizeLabel,
            planLabel: item.planLabel,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            isBundle: item.isBundle,
            bundleData: (item.bundleData as any) ?? undefined,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Store credit: spend it now. Fully-credit orders must get all of it (else the order is undone);
    // card orders were already charged for the rest, so they take what is there.
    if (pricing.walletUsed > 0 && userId && this.walletService) {
      try {
        const taken = await this.walletService.payForOrder({
          userId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: pricing.walletUsed,
          strict: input.paymentMode === 'wallet',
        });
        if (taken !== pricing.walletUsed) {
          await this.prisma.order.update({ where: { id: order.id }, data: { walletUsed: taken } });
          order.walletUsed = taken;
        }
      } catch (err) {
        if (input.paymentMode === 'wallet') {
          await this.prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
          throw err;
        }
        this.logger.error(`Store credit not taken for #${order.orderNumber}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (pricing.promoCode) {
      await this.prisma.coupon.updateMany({
        where: { code: pricing.promoCode },
        data: { uses: { increment: 1 } },
      });
    }

    this.logger.log(`Order ${order.orderNumber} successfully recorded in database.`);

    // Loyalty: spend the redeemed points, book the points this order earns (pending until delivered).
    if (this.loyaltyService) {
      await this.loyaltyService
        .recordOrder({
          orderId: order.id,
          orderNumber: order.orderNumber,
          redeemUserId: userId ?? null,
          pointsRedeemed: pricing.pointsRedeemed,
          earnUserId: finalUserId,
          pointsEarned,
          paid: paymentStatus === PaymentStatus.PAID || paymentStatus === PaymentStatus.PENDING,
        })
        .catch((err) => this.logger.error(`Loyalty booking failed for #${order.orderNumber}: ${err instanceof Error ? err.message : err}`));
    }

    // Send order confirmation email to admin & customer without blocking checkout response
    if (this.mailService) {
      const shippingAddr =
        (order.shippingAddress as Record<string, string | undefined>) ?? {};
      void this.mailService
        .sendOrderConfirmationEmails({
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone,
          status: order.status,
          paymentStatus: order.paymentStatus,
          subtotal: order.subtotal,
          discount: order.discount,
          bundleReward: order.bundleReward,
          promoCode: order.promoCode,
          shippingFee: order.shippingFee,
          shippingMethod: order.shippingMethod,
          total: order.total,
          shippingAddress: shippingAddr,
          items: order.items.map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            sizeLabel: item.sizeLabel,
            planLabel: item.planLabel,
          })),
        })
        .catch((err) => {
          this.logger.warn(
            `Order email dispatch failed for #${order.orderNumber}: ${err instanceof Error ? err.message : ''}`,
          );
        });
    }

    return order;
  }

  async getMyOrders(userId: string, email?: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    return this.prisma.order.findMany({
      where: normalizedEmail
        ? {
            OR: [{ userId }, { customerEmail: normalizedEmail }],
          }
        : { userId },
      include: {
        items: true,
        refundRequest: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestRefund(orderId: string, user: AuthUserPayload, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
      include: {
        items: true,
        refundRequest: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    const userEmail = user.email?.trim().toLowerCase();
    const isOwner =
      order.userId === user.sub ||
      (Boolean(userEmail) && order.customerEmail.toLowerCase() === userEmail);

    if (!isOwner) {
      throw new NotFoundException('Order not found.');
    }

    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Delivered orders cannot be requested for non-delivered refund.',
      );
    }

    if (order.paymentStatus === PaymentStatus.REFUNDED) {
      throw new BadRequestException('This order has already been refunded.');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled orders cannot be requested for refund.');
    }

    if (
      order.refundRequest &&
      (order.refundRequest.status === RefundStatus.REQUESTED ||
        order.refundRequest.status === RefundStatus.REFUNDED ||
        order.refundRequest.status === RefundStatus.APPROVED)
    ) {
      throw new ConflictException(
        'A refund request for this order is already in progress or completed.',
      );
    }

    const refundRequest = order.refundRequest
      ? await this.prisma.refundRequest.update({
          where: { id: order.refundRequest.id },
          data: {
            reason,
            status: RefundStatus.REQUESTED,
            adminNote: null,
            processedAt: null,
          },
          include: {
            order: { include: { items: true } },
          },
        })
      : await this.prisma.refundRequest.create({
          data: {
            orderId: order.id,
            userId: user.sub,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            amount: order.total,
            currency: order.currency,
            reason,
            status: RefundStatus.REQUESTED,
          },
          include: {
            order: { include: { items: true } },
          },
        });

    this.logger.log(
      `Refund request ${refundRequest.id} submitted for order #${order.orderNumber} by ${order.customerEmail}`,
    );

    return refundRequest;
  }

  async getAdminRefunds(params?: { status?: RefundStatus; search?: string }) {
    const where: any = {};
    if (
      params?.status &&
      Object.values(RefundStatus).includes(params.status)
    ) {
      where.status = params.status;
    }
    if (params?.search?.trim()) {
      const term = params.search.trim();
      where.OR = [
        { customerName: { contains: term } },
        { customerEmail: { contains: term } },
        { reason: { contains: term } },
        { order: { orderNumber: { contains: term } } },
      ];
    }

    const [refunds, allRefunds] = await Promise.all([
      this.prisma.refundRequest.findMany({
        where,
        include: {
          order: {
            include: {
              items: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.refundRequest.findMany({
        select: { status: true, amount: true },
      }),
    ]);

    const summary = {
      total: allRefunds.length,
      requested: allRefunds.filter((r) => r.status === RefundStatus.REQUESTED)
        .length,
      refunded: allRefunds.filter((r) => r.status === RefundStatus.REFUNDED)
        .length,
      rejected: allRefunds.filter((r) => r.status === RefundStatus.REJECTED)
        .length,
      totalRefundedAmount: round2(
        allRefunds
          .filter((r) => r.status === RefundStatus.REFUNDED)
          .reduce((sum, r) => sum + r.amount, 0),
      ),
    };

    return { refunds, summary };
  }

  async processRefund(refundId: string, input: ProcessRefundInput) {
    const refund = await this.prisma.refundRequest.findUnique({
      where: { id: refundId },
      include: {
        order: { include: { items: true } },
      },
    });

    if (!refund) {
      throw new NotFoundException('Refund request not found.');
    }

    if (refund.status === RefundStatus.REFUNDED) {
      throw new BadRequestException('This refund request has already been refunded.');
    }

    const adminNote = input.adminNote?.trim() || null;

    if (input.action === 'REJECT') {
      const updated = await this.prisma.refundRequest.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.REJECTED,
          adminNote,
          processedAt: new Date(),
        },
        include: {
          order: { include: { items: true } },
        },
      });
      this.logger.log(
        `Refund request ${refund.id} for order #${refund.order.orderNumber} rejected by admin.`,
      );
      return updated;
    }

    // APPROVE_REFUND: execute real Stripe refund when paid via Stripe
    const order = refund.order;
    if (order.paymentStatus === PaymentStatus.REFUNDED) {
      throw new BadRequestException('This order has already been refunded.');
    }

    let stripeRefundId: string | null = null;

    // Refunds always go back to the card through Stripe (only the card part was charged there).
    if (order.paymentMode === 'stripe' && order.paymentIntentId) {
      if (!this.stripe) {
        throw new BadRequestException(
          'Stripe is not configured on the server. Cannot process Stripe refund.',
        );
      }

      try {
        const stripeRefund = await this.stripe.refunds.create({
          payment_intent: order.paymentIntentId,
          reason: 'requested_by_customer',
          metadata: {
            orderNumber: order.orderNumber,
            orderId: order.id,
            refundRequestId: refund.id,
          },
        });
        stripeRefundId = stripeRefund.id;
        this.logger.log(
          `Stripe refund ${stripeRefund.id} created for order #${order.orderNumber} (PI: ${order.paymentIntentId})`,
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Stripe refund failed.';
        this.logger.error(
          `Stripe refund error for order #${order.orderNumber}: ${message}`,
        );
        throw new BadRequestException(`Stripe refund failed: ${message}`);
      }
    }

    const [updatedRefund] = await this.prisma.$transaction([
      this.prisma.refundRequest.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.REFUNDED,
          stripeRefundId,
          adminNote,
          processedAt: new Date(),
        },
        include: {
          order: { include: { items: true } },
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.REFUNDED,
          status: OrderStatus.CANCELLED,
        },
      }),
    ]);

    await this.syncLoyalty(order.id);

    // The part paid with store credit goes back to the wallet.
    await this.returnWallet(order);

    return {
      ...updatedRefund,
      order: {
        ...updatedRefund.order,
        paymentStatus: PaymentStatus.REFUNDED,
        status: OrderStatus.CANCELLED,
      },
    };
  }

  async getAllOrders(params?: {
    page?: number;
    limit?: number;
    status?: OrderStatus;
    search?: string;
    /** exclude (default) | only | include */
    archived?: ArchiveFilter;
  }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = { ...archiveWhere(params?.archived) };
    if (params?.status) {
      where.status = params.status;
    }
    if (params?.search) {
      const term = params.search.trim();
      where.OR = [
        { orderNumber: { contains: term } },
        { customerName: { contains: term } },
        { customerEmail: { contains: term } },
        { paymentIntentId: { contains: term } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          refundRequest: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderById(orderId: string, userId?: string, isAdmin = false) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
      include: {
        items: true,
        refundRequest: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    if (!isAdmin && order.userId && order.userId !== userId) {
      throw new NotFoundException('Order not found.');
    }

    return order;
  }

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status,
      },
      include: {
        items: true,
        refundRequest: true,
      },
    });
    // Delivered → pending points become spendable; cancelled → points reversed / returned.
    await this.syncLoyalty(order.id);
    if (status === OrderStatus.CANCELLED) await this.returnWallet(order);
    return updated;
  }

  /** How an order was paid, in words: "Store credit", "Visa •••• 4242", "Store credit + Visa •••• 4242". */
  private paymentLabelFor(mode: string, walletUsed: number, cardLabel?: string | null) {
    if (mode === 'wallet') return 'Store credit';
    const card = (cardLabel ?? '').trim().slice(0, 80) || (mode === 'demo' ? 'Card (test payment)' : 'Card');
    const label = card === 'Paid securely' ? 'Card' : card;
    return walletUsed > 0 ? `Store credit + ${label}` : label;
  }

  /** Gives back the store credit an order used (once). Never breaks the caller. */
  private async returnWallet(order: { id: string; orderNumber: string }) {
    if (!this.walletService) return;
    await this.walletService
      .returnForOrder(order)
      .catch((err) => this.logger.error(`Store credit return failed for #${order.orderNumber}: ${err instanceof Error ? err.message : err}`));
  }

  /** Re-checks an order's loyalty points after a status change. Never breaks the caller. */
  private async syncLoyalty(orderId: string) {
    if (!this.loyaltyService) return;
    await this.loyaltyService
      .syncOrder(orderId)
      .catch((err) => this.logger.error(`Loyalty sync failed for order ${orderId}: ${err instanceof Error ? err.message : err}`));
  }

  private async syncLoyaltyForPaymentIntent(paymentIntentId: string) {
    const orders = await this.prisma.order.findMany({ where: { paymentIntentId }, select: { id: true } });
    for (const o of orders) await this.syncLoyalty(o.id);
  }

  // ---------------------------------------------------------------------------
  // Order archive lifecycle: live -> archived -> permanently deleted.
  // Orders are looked up by id OR order number, same as the other admin routes.
  // ---------------------------------------------------------------------------

  private async findOrderOrThrow(orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
    });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    return order;
  }

  async archiveOrder(orderId: string) {
    const order = await this.findOrderOrThrow(orderId);
    if (order.archivedAt) return order;
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { archivedAt: new Date() },
    });
    this.logger.log(`Archived order ${order.orderNumber}`);
    return updated;
  }

  async unarchiveOrder(orderId: string) {
    const order = await this.findOrderOrThrow(orderId);
    if (!order.archivedAt) return order;
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { archivedAt: null },
    });
    this.logger.log(`Restored order ${order.orderNumber}`);
    return updated;
  }

  async archiveOrders(ids: string[]) {
    const result = await this.prisma.order.updateMany({
      where: { id: { in: ids }, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return { ok: true as const, count: result.count };
  }

  async unarchiveOrders(ids: string[]) {
    const result = await this.prisma.order.updateMany({
      where: { id: { in: ids }, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    return { ok: true as const, count: result.count };
  }

  /**
   * Permanent delete. Order items and any refund request are removed with it
   * (onDelete: Cascade). Throws 409 if the order is not archived.
   */
  async deleteArchivedOrder(orderId: string) {
    const order = await this.findOrderOrThrow(orderId);
    assertArchivedBeforeDelete(order, `Order ${order.orderNumber}`);

    await this.prisma.order.delete({ where: { id: order.id } });
    this.logger.warn(`Permanently deleted order ${order.orderNumber}`);
    return { ok: true as const, id: order.id };
  }

  /** Permanent bulk delete. All-or-nothing: throws 409 if any order is still live. */
  async deleteArchivedOrders(ids: string[]) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNumber: true, archivedAt: true },
    });
    assertAllArchivedBeforeDelete(
      orders.map((o) => ({ archivedAt: o.archivedAt, label: o.orderNumber })),
    );

    const result = await this.prisma.order.deleteMany({
      where: { id: { in: orders.map((o) => o.id) }, archivedAt: { not: null } },
    });
    this.logger.warn(`Permanently deleted ${result.count} archived orders`);
    return { ok: true as const, count: result.count };
  }

  async handleWebhook(rawBody: string | Buffer, signature?: string) {
    if (!this.stripe || !this.webhookSecret || !signature) {
      this.logger.warn('Stripe webhook received but webhook secret / stripe is not configured.');
      return { received: true };
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );

      if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object as Stripe.PaymentIntent;
        this.logger.log(`PaymentIntent ${intent.id} succeeded via webhook.`);
        await this.prisma.order.updateMany({
          where: { paymentIntentId: intent.id },
          // Payment only — the order status stays where the admin put it (new orders are Placed).
          data: { paymentStatus: PaymentStatus.PAID },
        });
      } else if (event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object as Stripe.PaymentIntent;
        this.logger.warn(`PaymentIntent ${intent.id} failed via webhook.`);
        await this.prisma.order.updateMany({
          where: { paymentIntentId: intent.id },
          data: {
            paymentStatus: PaymentStatus.FAILED,
          },
        });
        await this.syncLoyaltyForPaymentIntent(intent.id);
      } else if (event.type === 'charge.refunded') {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id;
        if (paymentIntentId) {
          this.logger.log(`Charge refunded via Stripe webhook for PI ${paymentIntentId}.`);
          await this.prisma.order.updateMany({
            where: { paymentIntentId },
            data: {
              paymentStatus: PaymentStatus.REFUNDED,
              status: OrderStatus.CANCELLED,
            },
          });
          await this.syncLoyaltyForPaymentIntent(paymentIntentId);
        }
      }

      return { received: true };
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err instanceof Error ? err.message : ''}`);
      throw new BadRequestException('Webhook signature verification failed.');
    }
  }
}
