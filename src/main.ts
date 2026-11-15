import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });

  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(join(uploadsDir, 'avatars'), { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  app.set('etag', false);
  app.use(cookieParser());
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('Api');

  // Ensure all auth endpoints are never cached by browsers, proxies, or Cloudflare
  app.use('/Api/auth', (_req: unknown, res: any, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  const rawCorsOrigins =
    process.env.CORS_ORIGINS ||
    process.env.CORS_ORIGIN ||
    'http://localhost:3000,https://slimza.vercel.app';
  const corsOrigins = rawCorsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
    ],
  });

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0', () => {
    console.log(`Server is running on port ${process.env.PORT ?? 4000}`);
  });
}
await bootstrap();
