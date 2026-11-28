import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../storage/storage.service.js';

export type MediaFolder = 'cms' | 'products' | 'avatars';

const ALLOWED_FOLDERS = new Set<string>(['cms', 'products', 'avatars']);

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly storage: StorageService) {}

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

  /** Upload to MinIO; returns the public URL to save. */
  async saveAsset(folder: MediaFolder, filename: string, mimeType: string, buffer: Buffer): Promise<{ url: string }> {
    const { url } = await this.storage.putObject(`${folder}/${filename}`, buffer, mimeType);
    return { url };
  }

  /** MinIO URL for a legacy /uploads/<folder>/<filename> link (null if it isn't one of ours). */
  legacyUrl(folder: string, filename: string): string | null {
    if (!this.isAllowedFolder(folder) || !this.isSafeFilename(filename)) return null;
    return this.storage.publicUrl(`${folder}/${filename}`);
  }

  /** Delete a file by its saved URL (MinIO or legacy /uploads link). Other URLs are ignored. */
  async deleteByUrl(url: string): Promise<void> {
    const key = this.storage.keyFromUrl(url);
    if (!key || !this.isAllowedFolder(key.split('/')[0])) return;
    await this.storage.deleteFile(key).catch((err) => this.logger.warn(`Could not delete ${key} from MinIO: ${String(err)}`));
  }
}
