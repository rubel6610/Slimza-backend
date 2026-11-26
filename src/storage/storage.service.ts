import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
export interface UploadedStorageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow('S3_BUCKET');
    const endpoint = this.configService.getOrThrow<string>('S3_ENDPOINT');
    const publicEndpoint =
      this.configService.get<string>('S3_PUBLIC_ENDPOINT') || endpoint;
    const cleanEndpoint = endpoint.endsWith('/')
      ? endpoint.slice(0, -1)
      : endpoint;
    const customPublicUrl = this.configService.get<string>('S3_PUBLIC_URL');
    const region = this.configService.getOrThrow('S3_REGION');
    const accessKeyId = this.configService.getOrThrow('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.getOrThrow('S3_SECRET_KEY');
    this.publicBaseUrl = customPublicUrl
      ? customPublicUrl.endsWith('/')
        ? customPublicUrl.slice(0, -1)
        : customPublicUrl
      : `${cleanEndpoint}/${this.bucket}`;

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Required for MinIO
    });

    this.presignS3 =
      publicEndpoint === endpoint
        ? this.s3
        : new S3Client({
            endpoint: publicEndpoint,
            region,
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
            forcePathStyle:true,
          });
  }

  async onModuleInit() {
    await this.BucketExists();
  }

  private async BucketExists() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" already exists`);
    } catch (error: any) {
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        this.logger.log(`Bucket "${this.bucket}" not found. Creating...`);
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" created successfully.`);
      } else {
        // অন্য কোনো এরর হলে (যেমন: ভুল পাসওয়ার্ড বা কানেকশন এরর) তা থ্রো করবে
        this.logger.error(`Error checking/creating bucket: ${error.message}`);
        throw error;
      }
    }

    await this.ensurePublicReadPolicy();
  }

  private async ensurePublicReadPolicy() {
    try {
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      };
      await this.s3.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify(policy),
        }),
      );
    } catch (error: any) {
      this.logger.warn(
        `Could not set public read policy on bucket "${this.bucket}": ${error?.message ?? String(error)}`,
      );
    }
  }

  async uploadFile(file: UploadedStorageFile, folder = 'uploads') {
    const cleanFolder =
      folder.split('/').filter(Boolean).join('/') || 'uploads';
    const extension = extname(file.originalname);
    const key = `${cleanFolder}/${randomUUID()}${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return {
      key,
      url: `${this.publicBaseUrl}/${key}`,
    };
  }
  /**
   * Upload under a key you choose ("cms/1795-banner.png"). Used by CMS and product uploads
   * (MediaService) so a file keeps its name. Returns the public URL that is saved in the database.
   */
  async putObject(key: string, body: Buffer, contentType: string) {
    const cleanKey = key.split('/').filter(Boolean).join('/');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        Body: body,
        ContentType: contentType,
        // File names are unique (timestamp / uuid), so browsers may cache them forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return { key: cleanKey, url: this.publicUrl(cleanKey) };
  }

  /** Public URL of an object: S3_PUBLIC_URL/<key>. */
  publicUrl(key: string) {
    return `${this.publicBaseUrl}/${key.split('/').filter(Boolean).join('/')}`;
  }

  /** Object key for one of our file URLs (MinIO URL or legacy /uploads/<folder>/<file>), else null. */
  keyFromUrl(url: string): string | null {
    const clean = url.split('?')[0].split('#')[0];
    if (clean.startsWith(`${this.publicBaseUrl}/`))
      return clean.slice(this.publicBaseUrl.length + 1) || null;
    const legacy = /^(?:https?:\/\/[^/]+)?\/uploads\/([a-z]+\/[^/\\]+)$/.exec(
      clean,
    );
    return legacy ? legacy[1] : null;
  }

  async deleteFile(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return { message: `File ${key} deleted successfully` };
  }

  async createUploadUrl(
    folder: 'cms' | 'products' | 'avatars',
    filename: string,
    contentType: string,
    expiresIn = 300,
  ) {
    const extension = extname(filename).toLowerCase();
    const key = `${folder}/${randomUUID()}${extension}`
    const uploadUrl = await getSignedUrl(
      this.presignS3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn },
    );
    return { key, uploadUrl, url: this.publicUrl(key) };
  }
}
