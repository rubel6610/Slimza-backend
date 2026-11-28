/**
 * Moves files uploaded before MinIO (CMS, product and avatar images) into the MinIO bucket and
 * points the database at them.
 *
 *  1. Collects every old file: MySQL table MediaAsset (bytes) + the given upload folders
 *     (default ./uploads; pass more with --dir=/path, each with cms/ products/ avatars/ inside).
 *  2. Uploads each one to MinIO as "<folder>/<filename>" (skips ones already there).
 *  3. Rewrites "/uploads/<folder>/<filename>" (with or without a host in front) to the MinIO URL
 *     (S3_PUBLIC_URL/<folder>/<filename>) in: CMS sections, products (image, gallery, sizes,
 *     variations), blogs, order items, subscriptions and user avatars.
 *     A reference is only rewritten when its file is in MinIO.
 *
 * Nothing is deleted — the old MySQL blobs and local files stay until you remove them yourself.
 *
 *   node scripts/migrate-uploads-to-minio.mjs                 # preview
 *   node scripts/migrate-uploads-to-minio.mjs --apply         # upload + rewrite
 *   node scripts/migrate-uploads-to-minio.mjs --apply --dir=/tmp/container-uploads
 *
 * Reads DATABASE_URL and S3_* from .env. Afterwards clear the Redis cache (or wait 5 minutes).
 */
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import mariadb from 'mariadb';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const apply = process.argv.includes('--apply');
const dirs = [resolve('uploads'), ...process.argv.filter((a) => a.startsWith('--dir=')).map((a) => resolve(a.slice(6)))];
const FOLDERS = ['cms', 'products', 'avatars'];
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const bucket = env('S3_BUCKET');
const publicBase = (process.env.S3_PUBLIC_URL || `${env('S3_ENDPOINT').replace(/\/$/, '')}/${bucket}`).replace(/\/$/, '');
const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT'),
  region: env('S3_REGION'),
  credentials: { accessKeyId: env('S3_ACCESS_KEY'), secretAccessKey: env('S3_SECRET_KEY') },
  forcePathStyle: true,
});

const url = new URL(env('DATABASE_URL'));
const db = await mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  allowPublicKeyRetrieval: true,
});

// ---- 1. collect old files ----------------------------------------------------------------
/** key "cms/123-a.png" → { load(), mime, from } */
const files = new Map();
for (const row of await db.query('SELECT folder, filename, mimeType FROM MediaAsset')) {
  const key = `${row.folder}/${row.filename}`;
  files.set(key, {
    from: 'mysql',
    mime: row.mimeType,
    load: async () => (await db.query('SELECT data FROM MediaAsset WHERE folder = ? AND filename = ?', [row.folder, row.filename]))[0].data,
  });
}
for (const dir of dirs) {
  for (const folder of FOLDERS) {
    let names = [];
    try {
      names = await readdir(join(dir, folder));
    } catch {
      continue;
    }
    for (const name of names) {
      const key = `${folder}/${name}`;
      if (files.has(key) || name.startsWith('.')) continue;
      files.set(key, { from: dir, mime: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream', load: () => readFile(join(dir, folder, name)) });
    }
  }
}

// ---- 2. upload to MinIO ------------------------------------------------------------------
const inMinio = new Set();
let uploaded = 0;
for (const [key, file] of files) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    inMinio.add(key);
    continue;
  } catch {
    // not there yet
  }
  if (!apply) {
    console.log(`would upload  ${key}  (from ${file.from})`);
    continue;
  }
  const body = await file.load();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: file.mime, CacheControl: 'public, max-age=31536000, immutable' }),
  );
  inMinio.add(key);
  uploaded++;
}

// ---- 3. rewrite references ---------------------------------------------------------------
const REF = /(?:https?:\/\/[^/"'\s\\]+)?\/uploads\/(cms|products|avatars)\/([^"'\s?#\\<>)]+)/g;
const missing = new Set();
const rewrite = (text) =>
  text.replace(REF, (match, folder, name) => {
    const key = `${folder}/${decodeURIComponent(name)}`;
    if (inMinio.has(key) || (!apply && files.has(key))) return `${publicBase}/${key}`;
    missing.add(key);
    return match;
  });

const targets = [
  ['CmsSection', 'key', ['data']],
  ['Product', 'id', ['image', 'gallery', 'sizes', 'variations']],
  ['Blog', 'id', ['image']],
  ['OrderItem', 'id', ['productImage', 'bundleData']],
  ['Subscription', 'id', ['productImage']],
  ['User', 'id', ['avatarUrl']],
];
let rewritten = 0;
for (const [table, pk, columns] of targets) {
  const rows = await db.query(`SELECT \`${pk}\` AS pk, ${columns.map((c) => `\`${c}\``).join(', ')} FROM \`${table}\``);
  for (const row of rows) {
    const updates = {};
    for (const col of columns) {
      const value = row[col];
      if (value === null || value === undefined) continue;
      const isJson = typeof value === 'object';
      const text = isJson ? JSON.stringify(value) : String(value);
      if (!text.includes('/uploads/')) continue;
      const next = rewrite(text);
      if (next !== text) updates[col] = next;
    }
    const cols = Object.keys(updates);
    if (!cols.length) continue;
    rewritten++;
    console.log(`${apply ? 'rewrite' : 'would rewrite'}  ${table} ${row.pk}: ${cols.join(', ')}`);
    if (apply) {
      await db.query(`UPDATE \`${table}\` SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE \`${pk}\` = ?`, [...cols.map((c) => updates[c]), row.pk]);
    }
  }
}

console.log(`\nOld files found: ${files.size} (${[...files.values()].filter((f) => f.from === 'mysql').length} in MySQL)`);
console.log(`${apply ? 'Uploaded' : 'To upload'} to MinIO: ${apply ? uploaded : files.size - inMinio.size} (already there: ${inMinio.size - (apply ? uploaded : 0)})`);
console.log(`Rows ${apply ? 'rewritten' : 'to rewrite'}: ${rewritten}`);
if (missing.size) {
  console.log(`\nReferenced but not found anywhere (left unchanged, ${missing.size}):`);
  for (const key of missing) console.log(`  ${key}`);
}
if (!apply) console.log('\nPreview only — run again with --apply.');
await db.end();
