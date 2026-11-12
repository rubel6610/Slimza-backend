import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { CookieOptions, Response } from 'express';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../auth/guards/jwt-auth.guard.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  createAddressSchema,
  updateAddressSchema,
  updateProfileSchema,
  uuidParamSchema,
  type CreateAddressInput,
  type UpdateAddressInput,
  type UpdateProfileInput,
} from './users.schemas.js';
import {
  UsersService,
  type UploadedAvatarFile,
} from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUserPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUserPayload,
    @Body({ schema: updateProfileSchema }) body: UpdateProfileInput,
  ) {
    return this.usersService.updateMe(user.sub, body);
  }

  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadAvatar(
    @CurrentUser() user: AuthUserPayload,
    @UploadedFile() file?: UploadedAvatarFile,
  ) {
    return this.usersService.updateAvatar(user.sub, file);
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: AuthUserPayload) {
    return this.usersService.removeAvatar(user.sub);
  }

  @Post('me/addresses')
  addAddress(
    @CurrentUser() user: AuthUserPayload,
    @Body({ schema: createAddressSchema }) body: CreateAddressInput,
  ) {
    return this.usersService.addAddress(user.sub, body);
  }

  @Patch('me/addresses/:id')
  updateAddress(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', { schema: uuidParamSchema }) id: string,
    @Body({ schema: updateAddressSchema }) body: UpdateAddressInput,
  ) {
    return this.usersService.updateAddress(user.sub, id, body);
  }

  @Patch('me/addresses/:id/default')
  setDefaultAddress(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', { schema: uuidParamSchema }) id: string,
  ) {
    return this.usersService.setDefaultAddress(user.sub, id);
  }

  @Delete('me/addresses/:id')
  removeAddress(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', { schema: uuidParamSchema }) id: string,
  ) {
    return this.usersService.removeAddress(user.sub, id);
  }

  @Post('me/deletion-request')
  requestAccountDeletion(@CurrentUser() user: AuthUserPayload) {
    return this.usersService.requestAccountDeletion(user.sub);
  }

  @Delete('me')
  async deleteMe(
    @CurrentUser() user: AuthUserPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.deleteMe(user.sub);
    const secure = this.config.get<string>('COOKIE_SECURE') === 'true';
    const sameSiteRaw = (
      this.config.get<string>('COOKIE_SAME_SITE') || 'lax'
    ).toLowerCase();
    const sameSite: CookieOptions['sameSite'] =
      sameSiteRaw === 'none' || sameSiteRaw === 'strict'
        ? sameSiteRaw
        : 'lax';
    const opts: CookieOptions = { httpOnly: true, secure, sameSite, path: '/' };
    res.clearCookie(ACCESS_COOKIE_NAME, opts);
    res.clearCookie(REFRESH_COOKIE_NAME, opts);
    return result;
  }

  @Roles(UserRole.ADMIN)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.usersService.remove(id);
  }
}
