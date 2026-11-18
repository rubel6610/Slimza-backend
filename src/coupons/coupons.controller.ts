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
} from '@nestjs/common';
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

  @Roles(UserRole.ADMIN)
  @Get()
  findAll() {
    return this.couponsService.findAll();
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

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.couponsService.remove(id);
  }
}
