import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  adminUsersPageQuerySchema,
  adminUsersQuerySchema,
  createAddressSchema,
  deleteMyAccountSchema,
  presignAvatarSchema,
  suspendUserSchema,
  updateAddressSchema,
  updateProfileSchema,
  uuidParamSchema,
  type AdminUsersPageQuery,
  type AdminUsersQuery,
  type CreateAddressInput,
  type DeleteMyAccountInput,
  type PresignAvatarInput,
  type SuspendUserInput,
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
  @Post('me/avatar/presign')
  presignAvatar(@Body({ schema: presignAvatarSchema }) body: PresignAvatarInput) {
    return this.usersService.presignAvatar(body);
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

  /**
   * The customer deletes their own account: body `{ password, reason? }`.
   * Soft delete (archived + `deletedAt`); an admin can restore it. Signs them out.
   */
  @Delete('me')
  async deleteMe(
    @CurrentUser() user: AuthUserPayload,
    @Body({ schema: deleteMyAccountSchema }) body: DeleteMyAccountInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.deleteMe(user.sub, body);
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

  // ---- Admin: users list, account status, archive lifecycle ----------------
  // Status rules: src/users/account-access.ts. Archive rules: src/common/archive/archive.ts.
  // Admins can't act on their own account or on other admin accounts (403).

  /**
   * Paginated version (new): `?page=&limit=&q=&sort=name:asc&archived=&status=&role=`
   * → `{ items, meta }`. Declared before `:id` so "paged" isn't read as a user id.
   * See docs/PAGINATION.md.
   */
  @Roles(UserRole.ADMIN)
  @Get('paged')
  findPage(@Query({ schema: adminUsersPageQuerySchema }) query: AdminUsersPageQuery) {
    return this.usersService.findPage(query);
  }

  /** Legacy: every user as one array. Kept until the dashboard uses /users/paged. */
  @Roles(UserRole.ADMIN)
  @Get()
  findAll(@Query({ schema: adminUsersQuerySchema }) query: AdminUsersQuery) {
    return this.usersService.findAll(query);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.usersService.findOne(id);
  }

  /** Blocks sign-in, buying, paying and every other account action. Signs the user out. */
  @Roles(UserRole.ADMIN)
  @Patch(':id/suspend')
  suspend(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @Body({ schema: suspendUserSchema }) body: SuspendUserInput,
    @CurrentUser() admin: AuthUserPayload,
  ) {
    return this.usersService.suspend(id, admin.sub, body.reason);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  activate(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @CurrentUser() admin: AuthUserPayload,
  ) {
    return this.usersService.activate(id, admin.sub);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/archive')
  archive(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @CurrentUser() admin: AuthUserPayload,
  ) {
    return this.usersService.archive(id, admin.sub);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/unarchive')
  unarchive(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @CurrentUser() admin: AuthUserPayload,
  ) {
    return this.usersService.unarchive(id, admin.sub);
  }

  /** Permanent. The user must be archived first (409 otherwise). Orders are kept. */
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @CurrentUser() admin: AuthUserPayload,
  ) {
    return this.usersService.remove(id, admin.sub);
  }
}
