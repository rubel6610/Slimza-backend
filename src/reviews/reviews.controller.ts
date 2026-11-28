import { Body, Controller, Delete, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  adminReviewsQuerySchema,
  adminUpdateReviewSchema,
  featuredReviewsQuerySchema,
  productRefParamSchema,
  productReviewsQuerySchema,
  reviewIdParamSchema,
  writeReviewSchema,
  type AdminReviewsQuery,
  type AdminUpdateReviewInput,
  type ProductReviewsQuery,
  type WriteReviewInput,
} from './reviews.schemas.js';
import { ReviewsService } from './reviews.service.js';

/**
 * Product reviews (docs/REVIEWS.md).
 *   Public:   GET /reviews/featured · GET /reviews/product/:idOrSlug
 *   Customer: GET /reviews/mine · GET|PUT|DELETE /reviews/product/:idOrSlug/mine
 *   Admin:    GET /reviews/admin(/stats) · PATCH /reviews/admin/:id
 *             PATCH /reviews/admin/:id/archive|unarchive · DELETE /reviews/admin/:id (archived only)
 */
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('featured')
  featured(@Query({ schema: featuredReviewsQuerySchema }) query: { limit: number }) {
    return this.reviews.featured(query.limit);
  }

  // ---- Admin (declared before :params) ----

  @Roles(UserRole.ADMIN)
  @Get('admin')
  adminList(@Query({ schema: adminReviewsQuerySchema }) query: AdminReviewsQuery) {
    return this.reviews.adminList(query);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/stats')
  adminStats() {
    return this.reviews.adminStats();
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/:id/archive')
  archive(@Param('id', { schema: reviewIdParamSchema }) id: string) {
    return this.reviews.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/:id/unarchive')
  unarchive(@Param('id', { schema: reviewIdParamSchema }) id: string) {
    return this.reviews.unarchive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/:id')
  adminUpdate(@Param('id', { schema: reviewIdParamSchema }) id: string, @Body({ schema: adminUpdateReviewSchema }) body: AdminUpdateReviewInput) {
    return this.reviews.adminUpdate(id, body);
  }

  /** Permanent. Archive first (409 otherwise). */
  @Roles(UserRole.ADMIN)
  @Delete('admin/:id')
  remove(@Param('id', { schema: reviewIdParamSchema }) id: string) {
    return this.reviews.remove(id);
  }

  // ---- Customer: Account → My reviews ----

  @Roles(UserRole.CUSTOMER)
  @Get('mine')
  myReviewList(@CurrentUser() user: AuthUserPayload) {
    return this.reviews.myReviewList(user.sub);
  }

  // ---- Product page ----

  @Public()
  @Get('product/:ref')
  listForProduct(@Param('ref', { schema: productRefParamSchema }) ref: string, @Query({ schema: productReviewsQuerySchema }) query: ProductReviewsQuery) {
    return this.reviews.listForProduct(ref, query);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('product/:ref/mine')
  mine(@CurrentUser() user: AuthUserPayload, @Param('ref', { schema: productRefParamSchema }) ref: string) {
    return this.reviews.mine(user.sub, ref);
  }

  @Roles(UserRole.CUSTOMER)
  @Put('product/:ref/mine')
  writeMine(
    @CurrentUser() user: AuthUserPayload,
    @Param('ref', { schema: productRefParamSchema }) ref: string,
    @Body({ schema: writeReviewSchema }) body: WriteReviewInput,
  ) {
    return this.reviews.writeMine(user.sub, ref, body);
  }

  @Roles(UserRole.CUSTOMER)
  @Delete('product/:ref/mine')
  deleteMine(@CurrentUser() user: AuthUserPayload, @Param('ref', { schema: productRefParamSchema }) ref: string) {
    return this.reviews.deleteMine(user.sub, ref);
  }
}
