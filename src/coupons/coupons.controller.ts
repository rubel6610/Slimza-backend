import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  archiveFilterSchema,
  type ArchiveFilter,
} from '../common/archive/archive.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
  type CreateCouponInput,
  type UpdateCouponInput,
  type ValidateCouponInput,
} from './coupons.schemas.js';
import { CouponsService } from './coupons.service.js';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Public()
  @Get('active')
  findActive() {
    return this.couponsService.findActive();
  }

  @Public()
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(@Body({ schema: validateCouponSchema }) body: ValidateCouponInput) {
    return this.couponsService.validateCode(body.code);
  }

  /** Admin list. `?archived=exclude|only|include` (default exclude). */
  @Roles(UserRole.ADMIN)
  @Get()
  findAll(@Query('archived', { schema: archiveFilterSchema }) archived: ArchiveFilter) {
    return this.couponsService.findAll(archived);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body({ schema: createCouponSchema }) body: CreateCouponInput) {
    return this.couponsService.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body({ schema: updateCouponSchema }) body: UpdateCouponInput,
  ) {
    return this.couponsService.update(id, body);
  }

  // ---- Archive lifecycle (src/common/archive/archive.ts) ------------------

  @Roles(UserRole.ADMIN)
  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.couponsService.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.couponsService.unarchive(id);
  }

  /** Permanent delete. The coupon must be archived first (409 otherwise). */
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.couponsService.remove(id);
  }
}
