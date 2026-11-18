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
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  UserRole,
} from '../generated/prisma/enums.js';
import { evaluateCouponStatus } from '../coupons/coupons.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CartBundleInput,
  CartLineInput,
  ConfirmOrderInput,
  CreatePaymentIntentInput,
  ProcessRefundInput,
} from './checkout.schemas.js';
import {
  BACKEND_BUNDLE_PRODUCTS,
  BACKEND_CATALOG,
  BUNDLE_SPEND_REWARD,
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
    @Optional() private readonly mailService?: MailService,
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
    },
    options?: { strictPromo?: boolean },
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
      promoCode: appliedPromoCode,
      lineItems,
    };
  }

  private async assertPurchaserIsNotAdmin(
    email?: string,
    userRole?: UserRole,
  ): Promise<void> {
    if (userRole === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Admin accounts are not allowed to purchase products. Please sign in with a customer account.',
      );
    }

    const normalizedEmail = email?.trim().toLowerCase();
    if (normalizedEmail && this.prisma.user?.findUnique) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { role: true },
      });
      if (existingUser?.role === UserRole.ADMIN) {
        throw new ForbiddenException(
          'Admin accounts are not allowed to purchase products. Please use a customer account.',
        );
      }
    }
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    userId?: string,
    userRole?: UserRole,
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
    await this.assertPurchaserIsNotAdmin(input.shippingAddress?.email, userRole);

    const pricing = await this.calculatePricing(
      {
        lines: input.lines,
        bundles: input.bundles,
        promoCode: input.promoCode,
        shippingMethodId: input.shippingMethodId,
      },
      { strictPromo: true },
    );

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
    userRole?: UserRole,
  ) {
    await this.assertPurchaserIsNotAdmin(input.shippingAddress?.email, userRole);

    const pricing = await this.calculatePricing(
      {
        lines: input.lines,
        bundles: input.bundles,
        promoCode: input.promoCode,
        shippingMethodId: input.shippingMethodId,
      },
      { strictPromo: input.paymentMode === 'demo' },
    );

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

    if (pricing.promoCode) {
      await this.prisma.coupon.updateMany({
        where: { code: pricing.promoCode },
        data: { uses: { increment: 1 } },
      });
    }

    this.logger.log(`Order ${order.orderNumber} successfully recorded in database.`);

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

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        status,
      },
      include: {
        items: true,
        refundRequest: true,
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
        }
      }

      return { received: true };
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err instanceof Error ? err.message : ''}`);
      throw new BadRequestException('Webhook signature verification failed.');
    }
  }
}
