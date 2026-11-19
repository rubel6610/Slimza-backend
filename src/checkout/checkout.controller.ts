import {
  Body,
  Controller,
  Delete,
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
  archiveFilterSchema,
  bulkIdsSchema,
  type ArchiveFilter,
  type BulkIdsInput,
} from '../common/archive/archive.js';
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
  processRefundSchema,
  requestRefundSchema,
  updateOrderStatusSchema,
  type ConfirmOrderInput,
  type CreatePaymentIntentInput,
  type ProcessRefundInput,
  type RequestRefundInput,
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
    return this.checkoutService.createPaymentIntent(body, user?.sub, user?.role);
  }

  @Public()
  @Post('confirm')
  async confirmOrder(
    @Body({ schema: confirmOrderSchema }) body: ConfirmOrderInput,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.checkoutService.confirmOrder(body, user?.sub, user?.role);
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
    return this.checkoutService.getMyOrders(user.sub, user.email);
  }

  @Post('my-orders/:id/refund-request')
  async requestRefund(
    @Param('id', { schema: orderIdParamSchema }) id: string,
    @Body({ schema: requestRefundSchema }) body: RequestRefundInput,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.checkoutService.requestRefund(id, user, body.reason);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/refunds')
  async getAdminRefunds(
    @Query('status') status?: any,
    @Query('search') search?: string,
  ) {
    return this.checkoutService.getAdminRefunds({ status, search });
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/refunds/:id/process')
  async processRefund(
    @Param('id', { schema: orderIdParamSchema }) id: string,
    @Body({ schema: processRefundSchema }) body: ProcessRefundInput,
  ) {
    return this.checkoutService.processRefund(id, body);
  }

  /** `?archived=exclude|only|include` (default exclude). Stats should use `include`. */
  @Roles(UserRole.ADMIN)
  @Get('admin/orders')
  async getAllOrders(
    @Query('archived', { schema: archiveFilterSchema }) archived: ArchiveFilter,
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
      archived,
    });
  }

  // ---- Order archive lifecycle (src/common/archive/archive.ts) ------------
  // Archiving only hides an order from the admin order list. Customers still
  // see it in "My orders" until it is permanently deleted.

  @Roles(UserRole.ADMIN)
  @Post('admin/orders/bulk-archive')
  async bulkArchiveOrders(@Body({ schema: bulkIdsSchema }) body: BulkIdsInput) {
    return this.checkoutService.archiveOrders(body.ids);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/orders/bulk-unarchive')
  async bulkUnarchiveOrders(@Body({ schema: bulkIdsSchema }) body: BulkIdsInput) {
    return this.checkoutService.unarchiveOrders(body.ids);
  }

  /** Permanent. Every order must already be archived, otherwise nothing is deleted (409). */
  @Roles(UserRole.ADMIN)
  @Post('admin/orders/bulk-delete')
  async bulkDeleteOrders(@Body({ schema: bulkIdsSchema }) body: BulkIdsInput) {
    return this.checkoutService.deleteArchivedOrders(body.ids);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/orders/:id/archive')
  async archiveOrder(@Param('id', { schema: orderIdParamSchema }) id: string) {
    return this.checkoutService.archiveOrder(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/orders/:id/unarchive')
  async unarchiveOrder(@Param('id', { schema: orderIdParamSchema }) id: string) {
    return this.checkoutService.unarchiveOrder(id);
  }

  /** Permanent delete (items + refund request cascade). Order must be archived first. */
  @Roles(UserRole.ADMIN)
  @Delete('admin/orders/:id')
  async deleteOrder(@Param('id', { schema: orderIdParamSchema }) id: string) {
    return this.checkoutService.deleteArchivedOrder(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/orders/:id/status')
  async updateOrderStatus(
    @Param('id', { schema: orderIdParamSchema }) id: string,
    @Body({ schema: updateOrderStatusSchema }) body: UpdateOrderStatusInput,
  ) {
    return this.checkoutService.updateOrderStatus(id, body.status);
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
