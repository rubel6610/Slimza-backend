import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
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
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow('S3_BUCKET');
    this.s3 = new S3Client({
      endpoint: this.configService.getOrThrow('S3_ENDPOINT'),
      region: this.configService.getOrThrow('S3_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('S3_ACCESS_KEY'),
        secretAccessKey: this.configService.getOrThrow('S3_SECRET_KEY'),
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async uploadFile(file: Express.Multer.File) {
    const extension = extname(file.originalname);
    const key = `uploads/${randomUUID()}${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
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
