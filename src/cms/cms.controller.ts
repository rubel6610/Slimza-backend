import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  cmsKeyParamSchema,
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

  @Public()
  @Get()
  getAllSections() {
    return this.cmsService.getAllSections();
  }

  @Public()
  @Get(':key')
  getSection(@Param('key', { schema: cmsKeyParamSchema }) key: string) {
    return this.cmsService.getSection(key);
  }

  @Roles(UserRole.ADMIN)
  @Put(':key')
  updateSection(
    @Param('key', { schema: cmsKeyParamSchema }) key: string,
    @Body({ schema: updateCmsSectionSchema }) body: UpdateCmsSectionInput,
  ) {
    return this.cmsService.updateSection(key, body.data);
  }

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

  @Roles(UserRole.ADMIN)
  @Get('newsletter/leads')
  getNewsletterLeads() {
    return this.cmsService.getNewsletterLeads();
  }

  @Roles(UserRole.ADMIN)
  @Patch('newsletter/leads/:id')
  updateNewsletterLeadStatus(
    @Param('id', { schema: uuidParamSchema }) id: string,
    @Body({ schema: updateNewsletterLeadSchema }) body: UpdateNewsletterLeadInput,
  ) {
    return this.cmsService.updateNewsletterLeadStatus(id, body.status);
  }

  @Roles(UserRole.ADMIN)
  @Delete('newsletter/leads/:id')
  deleteNewsletterLead(@Param('id', { schema: uuidParamSchema }) id: string) {
    return this.cmsService.deleteNewsletterLead(id);
  }
}
