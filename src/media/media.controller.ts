import { Controller, Get, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { MediaService } from './media.service.js';

/**
 * Old file links (/uploads/<folder>/<filename>, from before MinIO) → redirect to the file in MinIO.
 * New uploads save the MinIO URL directly, so this only keeps old links (emails, caches) working.
 */
@Public()
@SkipThrottle()
@Controller('uploads')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':folder/:filename')
  serveAsset(@Param('folder') folder: string, @Param('filename') filename: string, @Res() res: Response) {
    const url = this.mediaService.legacyUrl(folder, filename);
    if (!url) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).send('Media not found');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.redirect(302, url);
  }
}
