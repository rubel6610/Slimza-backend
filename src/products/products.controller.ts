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
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  bulkDeleteProductsSchema,
  createProductSchema,
  queryProductSchema,
  updateProductSchema,
  type BulkDeleteProductsInput,
  type CreateProductInput,
  type QueryProductInput,
  type UpdateProductInput,
} from './products.schemas.js';
import { ProductsService, type UploadedProductFile } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  findAll(@Query({ schema: queryProductSchema }) query: QueryProductInput) {
    return this.productsService.findAll(query);
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

  @Roles(UserRole.ADMIN)
  @Post('bulk-delete')
  bulkDelete(@Body({ schema: bulkDeleteProductsSchema }) body: BulkDeleteProductsInput) {
    return this.productsService.deleteMany(body.ids);
  }

  @Public()
  @Get(':idOrSlug')
  findOne(@Param('idOrSlug') idOrSlug: string) {
    return this.productsService.findOne(idOrSlug);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body({ schema: createProductSchema }) body: CreateProductInput) {
    return this.productsService.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body({ schema: updateProductSchema }) body: UpdateProductInput,
  ) {
    return this.productsService.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
