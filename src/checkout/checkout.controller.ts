import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  confirmOrderSchema,
  createPaymentIntentSchema,
  orderIdParamSchema,
  updateOrderStatusSchema,
  type ConfirmOrderInput,
  type CreatePaymentIntentInput,
  type UpdateOrderStatusInput,
} from './checkout.schemas.js';
import { CheckoutService } from './checkout.service.js';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Public()
  @Get('config')
  getConfig() {
    return {
      publishableKey: this.checkoutService.getPublishableKey(),
    };
  }

  @Public()
  @Post('create-payment-intent')
  async createPaymentIntent(
    @Body({ schema: createPaymentIntentSchema }) body: CreatePaymentIntentInput,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.checkoutService.createPaymentIntent(body, user?.sub);
  }

  @Public()
  @Post('confirm')
  async confirmOrder(
    @Body({ schema: confirmOrderSchema }) body: ConfirmOrderInput,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.checkoutService.confirmOrder(body, user?.sub);
  }

  @Public()
  @Post('webhook')
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature?: string,
  ) {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? req.body;
    return this.checkoutService.handleWebhook(rawBody, signature);
  }

  @Get('my-orders')
  async getMyOrders(@CurrentUser() user: AuthUserPayload) {
    return this.checkoutService.getMyOrders(user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/orders')
  async getAllOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: any,
    @Query('search') search?: string,
  ) {
    return this.checkoutService.getAllOrders({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      search,
    });
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/orders/:id/status')
  async updateOrderStatus(
    @Param('id', { schema: orderIdParamSchema }) id: string,
    @Body({ schema: updateOrderStatusSchema }) body: UpdateOrderStatusInput,
  ) {
    return this.checkoutService.updateOrderStatus(
      id,
      body.status,
      body.paymentStatus,
    );
  }

  @Get(':id')
  async getOrder(
    @Param('id', { schema: orderIdParamSchema }) id: string,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    const isAdmin = user?.role === UserRole.ADMIN;
    return this.checkoutService.getOrderById(id, user?.sub, isAdmin);
  }
}
