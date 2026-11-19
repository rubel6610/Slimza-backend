import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../auth/decorators/current-user.decorator.js';
import {
  archiveFilterSchema,
  type ArchiveFilter,
} from '../common/archive/archive.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  cmsItemIdParamSchema,
  cmsKeyParamSchema,
  includeArchivedQuerySchema,
  subscribeNewsletterSchema,
  updateCmsSectionSchema,
  updateNewsletterLeadSchema,
  uuidParamSchema,
  type SubscribeNewsletterInput,
  type UpdateCmsSectionInput,
  type UpdateNewsletterLeadInput,
} from './cms.schemas.js';
import { CmsService, type UploadedCmsFile } from './cms.service.js';

@Controller('cms')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  /** `?includeArchived=true` returns archived items too — admins only, ignored for everyone else. */
  @Public()
  @Get()
  getAllSections(
    @Query('includeArchived', { schema: includeArchivedQuerySchema }) includeArchived: boolean,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.cmsService.getAllSections(includeArchived && user?.role === UserRole.ADMIN);
  }

  @Public()
  @Get(':key')
  getSection(
    @Param('key', { schema: cmsKeyParamSchema }) key: string,
    @Query('includeArchived', { schema: includeArchivedQuerySchema }) includeArchived: boolean,
    @CurrentUser() user?: AuthUserPayload,
  ) {
    return this.cmsService.getSection(key, includeArchived && user?.role === UserRole.ADMIN);
  }

  /** Full-section save. Can never remove a list item (409) — use the item endpoints below. */
  @Roles(UserRole.ADMIN)
  @Put(':key')
  updateSection(
    @Param('key', { schema: cmsKeyParamSchema }) key: string,
    @Body({ schema: updateCmsSectionSchema }) body: UpdateCmsSectionInput,
  ) {
    return this.cmsService.updateSection(key, body.data);
  }

  // ---- Section item archive lifecycle ---------------------------------------

  @Roles(UserRole.ADMIN)
  @Patch(':key/items/:itemId/archive')
  archiveSectionItem(
    @Param('key', { schema: cmsKeyParamSchema }) key: string,
    @Param('itemId', { schema: cmsItemIdParamSchema }) itemId: string,
  ) {
    return this.cmsService.archiveSectionItem(key, itemId);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':key/items/:itemId/unarchive')
  unarchiveSectionItem(
    @Param('key', { schema: cmsKeyParamSchema }) key: string,
    @Param('itemId', { schema: cmsItemIdParamSchema }) itemId: string,
  ) {
    return this.cmsService.unarchiveSectionItem(key, itemId);
  }

  /** Permanent. The item must be archived first (409 otherwise). */
  @Roles(UserRole.ADMIN)
  @Delete(':key/items/:itemId')
  deleteArchivedSectionItem(
    @Param('key', { schema: cmsKeyParamSchema }) key: string,
    @Param('itemId', { schema: cmsItemIdParamSchema }) itemId: string,
  ) {
    return this.cmsService.deleteArchivedSectionItem(key, itemId);
  }

  /** Restores defaults. Items you added are moved to the archive, not deleted. */
  @Roles(UserRole.ADMIN)
  @Post(':key/reset')
  resetSection(@Param('key', { schema: cmsKeyParamSchema }) key: string) {
    return this.cmsService.resetSection(key);
  }

  @Roles(UserRole.ADMIN)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file?: UploadedCmsFile) {
    return this.cmsService.saveUploadedFile(file);
  }

  @Public()
  @Post('newsletter/subscribe')
  subscribeNewsletter(
    @Body({ schema: subscribeNewsletterSchema }) body: SubscribeNewsletterInput,
  ) {
    return this.cmsService.subscribeNewsletter(body.email, body.source);
  }

  /** `?archived=exclude|only|include` (default exclude). */
  @Roles(UserRole.ADMIN)
  @Get('newsletter/leads')
  getNewsletterLeads(
    @Query('archived', { schema: archiveFilterSchema }) archived: ArchiveFilter,
  ) {
    return this.cmsService.getNewsletterLeads(archived);
  }

  @Roles(UserRole.ADMIN)
  @Patch('newsletter/leads/:id/archive')
  archiveNewsletterLead(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.cmsService.archiveNewsletterLead(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('newsletter/leads/:id/unarchive')
  unarchiveNewsletterLead(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.cmsService.unarchiveNewsletterLead(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('newsletter/leads/:id')
  updateNewsletterLeadStatus(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @Body({ schema: updateNewsletterLeadSchema }) body: UpdateNewsletterLeadInput,
  ) {
    return this.cmsService.updateNewsletterLeadStatus(id, body.status);
  }

  /** Permanent. The lead must be archived first (409 otherwise). */
  @Roles(UserRole.ADMIN)
  @Delete('newsletter/leads/:id')
  deleteNewsletterLead(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.cmsService.deleteNewsletterLead(id);
  }
}
