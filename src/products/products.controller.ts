import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  bulkProductIdsSchema,
  createProductSchema,
  queryProductSchema,
  updateProductSchema,
  type BulkProductIdsInput,
  type CreateProductInput,
  type QueryProductInput,
  type UpdateProductInput,
} from './products.schemas.js';
import { ProductsService, type UploadedProductFile } from './products.service.js';

/**
 * Products follow the archive lifecycle (src/common/archive/archive.ts):
 *   live ──PATCH :id/archive──▶ archived ──DELETE :id──▶ gone
 *        ◀─PATCH :id/unarchive─
 * DELETE only works on archived products (409 otherwise).
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /** Storefront + dashboard list. `?archived=only|include` is honoured for admins only. */
  @Public()
  @Get()
  findAll(
    @Query({ schema: queryProductSchema }) query: QueryProductInput,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.productsService.findAll(query, user?.role === UserRole.ADMIN);
  }

  @Roles(UserRole.ADMIN)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadProductImage(@UploadedFile() file?: UploadedProductFile) {
    return this.productsService.saveUploadedFile(file);
  }

  // ---- Bulk archive lifecycle -------------------------------------------

  @Roles(UserRole.ADMIN)
  @Post('bulk-archive')
  bulkArchive(@Body({ schema: bulkProductIdsSchema }) body: BulkProductIdsInput) {
    return this.productsService.archiveMany(body.ids);
  }

  @Roles(UserRole.ADMIN)
  @Post('bulk-unarchive')
  bulkUnarchive(@Body({ schema: bulkProductIdsSchema }) body: BulkProductIdsInput) {
    return this.productsService.unarchiveMany(body.ids);
  }

  /** Permanent. Every id must already be archived, otherwise nothing is deleted (409). */
  @Roles(UserRole.ADMIN)
  @Post('bulk-delete')
  bulkDelete(@Body({ schema: bulkProductIdsSchema }) body: BulkProductIdsInput) {
    return this.productsService.deleteMany(body.ids);
  }

  // ---- Single product -----------------------------------------------------

  /** Archived products return 404 to everyone except admins. */
  @Public()
  @Get(':idOrSlug')
  findOne(
    @Param('idOrSlug') idOrSlug: string,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.productsService.findOne(idOrSlug, user?.role === UserRole.ADMIN);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body({ schema: createProductSchema }) body: CreateProductInput) {
    return this.productsService.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.productsService.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.productsService.unarchive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body({ schema: updateProductSchema }) body: UpdateProductInput,
  ) {
    return this.productsService.update(id, body);
  }

  /** Permanent delete. The product must be archived first (409 otherwise). */
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
