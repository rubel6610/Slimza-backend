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

export interface UploadedStorageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow('S3_BUCKET');
    const endpoint = this.configService.getOrThrow<string>('S3_ENDPOINT');
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const customPublicUrl = this.configService.get<string>('S3_PUBLIC_URL');
    this.publicBaseUrl = customPublicUrl
      ? customPublicUrl.endsWith('/')
        ? customPublicUrl.slice(0, -1)
        : customPublicUrl
      : `${cleanEndpoint}/${this.bucket}`;

    this.s3 = new S3Client({
      endpoint,
      region: this.configService.getOrThrow('S3_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('S3_ACCESS_KEY'),
        secretAccessKey: this.configService.getOrThrow('S3_SECRET_KEY'),
      },
      forcePathStyle: true, // Required for MinIO
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
    const cleanFolder = folder.split('/').filter(Boolean).join('/') || 'uploads';
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
  async deleteFile(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return { message: `File ${key} deleted successfully` };
  }
}
