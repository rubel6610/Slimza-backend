import { Controller, Get, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { MediaService } from './media.service.js';

@Public()
@SkipThrottle()
@Controller('uploads')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':folder/:filename')
  async serveAsset(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const asset = await this.mediaService.getAsset(folder, filename);
    if (!asset) {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      );
      res.status(404).send('Media not found');
      return;
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.data.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.status(200).send(asset.data);
  }
}
