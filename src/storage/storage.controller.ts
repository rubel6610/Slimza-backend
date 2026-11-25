import {
  BadRequestException,
  Controller,
  Delete,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService, type UploadedStorageFile } from './storage.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}
  @Roles(UserRole.ADMIN)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadFile(@UploadedFile() file?: UploadedStorageFile) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type');
    }

    return this.storageService.uploadFile(file);
  }

  @Roles(UserRole.ADMIN)
  @Delete()
  async deleteFile(@Query('key') key?: string) {
    const cleaned = key?.trim();
    if (!cleaned) {
      throw new BadRequestException('File key is required');
    }
    return this.storageService.deleteFile(cleaned);
  }
}
