import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { OrderStatus, PaymentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CartBundleInput,
  CartLineInput,
  ConfirmOrderInput,
  CreatePaymentIntentInput,
} from './checkout.schemas.js';
import {
  BACKEND_BUNDLE_PRODUCTS,
  BACKEND_CATALOG,
  BUNDLE_SPEND_REWARD,
  PROMO_CODES,
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
  shipping: number;
  shippingMethod: { id: string; name: string; fee: number; eta: string };
  total: number;
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

  calculatePricing(input: {
    lines?: CartLineInput[];
    bundles?: CartBundleInput[];
    promoCode?: string | null;
    shippingMethodId?: string;
  }): CalculatedPricing {
    const lines = input.lines ?? [];
    const bundles = input.bundles ?? [];
    const lineItems: CalculatedPricing['lineItems'] = [];

    let rawLinesSubtotal = 0;

    for (const line of lines) {
      if (!line.qty || line.qty <= 0) continue;
      const product = BACKEND_CATALOG[line.productId];
      const name = product ? product.name : `Product ${line.productId}`;
      const basePrice = product ? product.price : 25;
      const sizeType = product ? product.sizeType : 'powder';
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
        productImage: product?.image ?? '',
        sizeLabel: sizeOption.label,
        planLabel: plan.label,
        quantity: line.qty,
        unitPrice,
        totalPrice: lineTotal,
        isBundle: false,
      });
    }

    let rawBundlesSubtotal = 0;
    let bundleSpend = 0;

    for (const b of bundles) {
      if (!b.qty || b.qty <= 0 || !Array.isArray(b.items)) continue;
      let singleBundleTotal = 0;
      const parsedItems: Array<{ productId: string; name: string; price: number; qty: number }> = [];

      for (const item of b.items) {
        const bp = BACKEND_BUNDLE_PRODUCTS[item.productId];
        const itemPrice = bp ? bp.price : 10;
        const itemQty = item.qty && item.qty > 0 ? item.qty : 1;
        const itemName = bp ? bp.name : item.productId;
        singleBundleTotal += itemPrice * itemQty;
        parsedItems.push({
          productId: item.productId,
          name: itemName,
          price: itemPrice,
          qty: itemQty,
        });
      }

      const bundleTotal = round2(singleBundleTotal * b.qty);
      rawBundlesSubtotal += bundleTotal;
      bundleSpend += bundleTotal;

      lineItems.push({
        productId: `bundle-${b.items.map((i) => i.productId).join('+')}`,
        productName: `Custom Bundle (${parsedItems.map((i) => i.name).join(', ')})`,
        productImage: '/shop-categories/Herbal Wellness Tea.png',
        sizeLabel: 'Custom Bundle',
        planLabel: `${b.items.length} items`,
        quantity: b.qty,
        unitPrice: round2(singleBundleTotal),
        totalPrice: bundleTotal,
        isBundle: true,
        bundleData: { items: parsedItems },
      });
    }

    const subtotal = round2(rawLinesSubtotal + rawBundlesSubtotal);
    const bundleSavings = 0; // Currently full price with bundle spend reward

    const normalizedPromo = input.promoCode
      ? input.promoCode.trim().toUpperCase()
      : null;
    const promoRate =
      normalizedPromo && PROMO_CODES[normalizedPromo]
        ? PROMO_CODES[normalizedPromo]
        : 0;
    const discount = round2(subtotal * promoRate);

    const bundleReward =
      bundleSpend >= BUNDLE_SPEND_REWARD.threshold
        ? BUNDLE_SPEND_REWARD.amount
        : 0;

    const selectedShipping =
      input.shippingMethodId && SHIPPING_METHODS[input.shippingMethodId]
        ? SHIPPING_METHODS[input.shippingMethodId]
        : SHIPPING_METHODS['uk-standard'];

    const shipping =
      lineItems.length > 0 ? selectedShipping.fee : 0;

    const total = Math.max(
      0,
      round2(subtotal - discount - bundleReward + shipping),
    );
    const totalInPence = Math.round(total * 100);

    return {
      subtotal,
      discount,
      bundleSavings,
      bundleSpend,
      bundleReward,
      shipping,
      shippingMethod: selectedShipping,
      total,
      totalInPence,
      promoCode: promoRate > 0 ? normalizedPromo : null,
      lineItems,
    };
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    userId?: string,
  ): Promise<{
    mode: 'stripe' | 'demo';
    clientSecret: string | null;
    paymentIntentId: string | null;
    pricing: {
      total: number;
      shipping: number;
      discount: number;
      shippingMethod: { id: string; name: string; fee: number; eta: string };
    };
  }> {
    const pricing = this.calculatePricing({
      lines: input.lines,
      bundles: input.bundles,
      promoCode: input.promoCode,
      shippingMethodId: input.shippingMethodId,
    });

    if (pricing.total <= 0) {
      throw new BadRequestException('Shopping basket is empty or has a total of zero.');
    }

    if (!this.stripe) {
      this.logger.warn('Stripe secret key is not set. Falling back to demo mode.');
      return {
        mode: 'demo',
        clientSecret: null,
        paymentIntentId: null,
        pricing: {
          total: pricing.total,
          shipping: pricing.shipping,
          discount: pricing.discount,
          shippingMethod: pricing.shippingMethod,
        },
      };
    }

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: pricing.totalInPence,
        currency: 'gbp',
        automatic_payment_methods: {
          enabled: true,
        },
        receipt_email: input.shippingAddress.email,
        metadata: {
          customerName: input.shippingAddress.name,
          customerEmail: input.shippingAddress.email,
          customerPhone: input.shippingAddress.phone,
          shippingMethod: pricing.shippingMethod.id,
          promoCode: pricing.promoCode ?? '',
          userId: userId ?? '',
        },
      });

      return {
        mode: 'stripe',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        pricing: {
          total: pricing.total,
          shipping: pricing.shipping,
          discount: pricing.discount,
          shippingMethod: pricing.shippingMethod,
        },
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
  ) {
    const pricing = this.calculatePricing({
      lines: input.lines,
      bundles: input.bundles,
      promoCode: input.promoCode,
      shippingMethodId: input.shippingMethodId,
    });

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
    let orderStatus: OrderStatus = OrderStatus.PROCESSING;
    let stripeChargeId: string | null = null;

    if (input.paymentIntentId && this.stripe) {
      try {
        const intent = await this.stripe.paymentIntents.retrieve(
          input.paymentIntentId,
        );
        if (intent.status === 'succeeded') {
          paymentStatus = PaymentStatus.PAID;
          orderStatus = OrderStatus.PROCESSING;
          if (typeof intent.latest_charge === 'string') {
            stripeChargeId = intent.latest_charge;
          }
        } else if (intent.status === 'processing') {
          paymentStatus = PaymentStatus.PENDING;
          orderStatus = OrderStatus.PENDING;
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
        promoCode: pricing.promoCode,
        total: pricing.total,
        currency: 'gbp',
        status: orderStatus,
        paymentStatus,
        paymentMode: input.paymentMode ?? 'stripe',
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

    this.logger.log(`Order ${order.orderNumber} successfully recorded in database.`);
    return order;
  }

  async getMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllOrders(params?: {
    page?: number;
    limit?: number;
    status?: OrderStatus;
    search?: string;
  }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params?.status) {
      where.status = params.status;
    }
    if (params?.search) {
      const term = params.search.trim();
      where.OR = [
        { orderNumber: { contains: term, mode: 'insensitive' } },
        { customerName: { contains: term, mode: 'insensitive' } },
        { customerEmail: { contains: term, mode: 'insensitive' } },
        { paymentIntentId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
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

  async updateOrderStatus(
    orderId: string,
    status?: OrderStatus,
    paymentStatus?: PaymentStatus,
  ) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...(status ? { status } : {}),
        ...(paymentStatus ? { paymentStatus } : {}),
      },
      include: {
        items: true,
      },
    });
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
          data: {
            paymentStatus: PaymentStatus.PAID,
            status: OrderStatus.PROCESSING,
          },
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
      }

      return { received: true };
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err instanceof Error ? err.message : ''}`);
      throw new BadRequestException('Webhook signature verification failed.');
    }
  }
}
