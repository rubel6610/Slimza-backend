import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  createFranchiseApplicationSchema,
  franchiseIdParamSchema,
  franchiseListQuerySchema,
  updateFranchiseApplicationSchema,
  type CreateFranchiseApplicationInput,
  type FranchiseListQuery,
  type UpdateFranchiseApplicationInput,
} from './franchise.schemas.js';
import { FranchiseService } from './franchise.service.js';


@Controller('franchise/applications')
export class FranchiseController {
  constructor(private readonly franchiseService: FranchiseService) {}

  /** 5 submissions per minute per IP, on top of the global limit, to keep spam down. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  create(@Body({ schema: createFranchiseApplicationSchema }) body: CreateFranchiseApplicationInput) {
    return this.franchiseService.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Get()
  findAll(@Query({ schema: franchiseListQuerySchema }) query: FranchiseListQuery) {
    return this.franchiseService.findAll(query);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/archive')
  archive(@Param('id', { schema: franchiseIdParamSchema }) id: string) {
    return this.franchiseService.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/unarchive')
  unarchive(@Param('id', { schema: franchiseIdParamSchema }) id: string) {
    return this.franchiseService.unarchive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id', { schema: franchiseIdParamSchema }) id: string,
    @Body({ schema: updateFranchiseApplicationSchema }) body: UpdateFranchiseApplicationInput,
  ) {
    return this.franchiseService.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id', { schema: franchiseIdParamSchema }) id: string) {
    return this.franchiseService.remove(id);
  }
}
