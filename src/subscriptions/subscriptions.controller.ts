import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { SubscriptionsService } from './subscriptions.service.js';

const idParam = z.string().trim().min(1).max(64);
const adminListQuery = z.object({ status: z.enum(['ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED']).optional() });
const cancelBody = z.object({ reason: z.string().trim().max(300).optional() });
const settingsBody = z.object({ data: z.unknown() });

/**
 * Subscribe & Save (docs/SUBSCRIPTIONS.md).
 *   Public:   GET /subscriptions/settings
 *   Customer: GET /subscriptions/mine · POST /subscriptions/mine/:id/cancel
 *   Admin:    GET /subscriptions/admin · PUT /subscriptions/admin/settings
 *             POST /subscriptions/admin/:id/cancel · POST /subscriptions/admin/:id/renew-now
 */
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get('settings')
  settings() {
    return this.subscriptions.publicSettings();
  }

  @Roles(UserRole.CUSTOMER)
  @Get('mine')
  mine(@CurrentUser() user: AuthUserPayload) {
    return this.subscriptions.listMine(user.sub);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('mine/:id/cancel')
  cancelMine(@CurrentUser() user: AuthUserPayload, @Param('id', { schema: idParam }) id: string) {
    return this.subscriptions.cancelMine(user.sub, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('mine/:id/pause')
  pauseMine(@CurrentUser() user: AuthUserPayload, @Param('id', { schema: idParam }) id: string) {
    return this.subscriptions.pauseMine(user.sub, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('mine/:id/resume')
  resumeMine(@CurrentUser() user: AuthUserPayload, @Param('id', { schema: idParam }) id: string) {
    return this.subscriptions.resumeMine(user.sub, id);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/:id/pause')
  adminPause(@Param('id', { schema: idParam }) id: string) {
    return this.subscriptions.adminSetPaused(id, true);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/:id/resume')
  adminResume(@Param('id', { schema: idParam }) id: string) {
    return this.subscriptions.adminSetPaused(id, false);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin')
  adminList(@Query({ schema: adminListQuery }) query: z.infer<typeof adminListQuery>) {
    return this.subscriptions.adminList(query.status);
  }

  @Roles(UserRole.ADMIN)
  @Put('admin/settings')
  saveSettings(@Body({ schema: settingsBody }) body: z.infer<typeof settingsBody>) {
    return this.subscriptions.saveSettings(body.data);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/:id/cancel')
  adminCancel(@Param('id', { schema: idParam }) id: string, @Body({ schema: cancelBody }) body: z.infer<typeof cancelBody>) {
    return this.subscriptions.adminCancel(id, body.reason);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/:id/renew-now')
  renewNow(@Param('id', { schema: idParam }) id: string) {
    return this.subscriptions.adminRenewNow(id);
  }
}
