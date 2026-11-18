import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';

export type MediaFolder = 'cms' | 'products' | 'avatars';

const ALLOWED_FOLDERS = new Set<string>(['cms', 'products', 'avatars']);

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly prisma: PrismaService) {}

  isAllowedFolder(folder: string): folder is MediaFolder {
    return ALLOWED_FOLDERS.has(folder);
  }

  isSafeFilename(filename: string): boolean {
    return (
      filename.length > 0 &&
      filename.length <= 190 &&
      !filename.includes('..') &&
      !filename.includes('/') &&
      !filename.includes('\\') &&
      !filename.includes('\0')
    );
  }

  async saveAsset(
    folder: MediaFolder,
    filename: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<{ url: string }> {
    const bytes = Uint8Array.from(buffer);

    await this.prisma.mediaAsset.upsert({
      where: { folder_filename: { folder, filename } },
      create: {
        folder,
        filename,
        mimeType,
        size: buffer.length,
        data: bytes,
      },
      update: {
        mimeType,
        size: buffer.length,
        data: bytes,
      },
    });

    // Best-effort local disk mirror for local development inspection
    try {
      const dir = join(process.cwd(), 'uploads', folder);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), buffer);
    } catch (err) {
      this.logger.debug(
        `Skipping local disk mirror for ${folder}/${filename}: ${String(err)}`,
      );
    }

    return { url: `/uploads/${folder}/${filename}` };
  }

  async getAsset(
    folder: string,
    filename: string,
  ): Promise<{ mimeType: string; data: Buffer } | null> {
    if (!this.isAllowedFolder(folder) || !this.isSafeFilename(filename)) {
      return null;
    }

    const record = await this.prisma.mediaAsset.findUnique({
      where: { folder_filename: { folder, filename } },
      select: { mimeType: true, data: true },
    });

    if (record) {
      return {
        mimeType: record.mimeType,
        data: Buffer.from(record.data),
      };
    }

    // Fallback to local disk for any pre-existing uploaded files
    try {
      const diskPath = join(process.cwd(), 'uploads', folder, filename);
      const data = await readFile(diskPath);
      const ext = extname(filename).toLowerCase();
      const mimeType = EXT_TO_MIME[ext] ?? 'application/octet-stream';
      return { mimeType, data };
    } catch {
      return null;
    }
  }

  async deleteByUrl(url: string): Promise<void> {
    const match = /^\/uploads\/(cms|products|avatars)\/([^/\\]+)$/.exec(url);
    if (!match) return;
    const [, folder, filename] = match;
    if (!this.isSafeFilename(filename)) return;

    try {
      await this.prisma.mediaAsset.deleteMany({
        where: { folder, filename },
      });
    } catch (err) {
      this.logger.debug(
        `Failed to delete media asset ${folder}/${filename} from DB: ${String(err)}`,
      );
    }

    try {
      await unlink(join(process.cwd(), 'uploads', folder, filename));
    } catch {
      // File may not exist on disk; ignore.
    }
  }
}
