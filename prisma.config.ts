import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function resolveDatabaseUrl(): string {
  const explicitUrl = process.env.DATABASE_URL?.trim();
  const dbHost = process.env.DB_HOST?.trim();
  const dbName = process.env.DB_NAME?.trim();
  const dbUser = process.env.DB_USER?.trim();
  const dbPassword = process.env.DB_PASSWORD ?? '';
  const dbPort = Number.parseInt(process.env.DB_PORT || '3306', 10) || 3306;

  if (dbHost && dbName && dbUser) {
    return `mysql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`;
  }
  if (explicitUrl) {
    return explicitUrl;
  }
  return 'mysql://root:password@localhost:3306/slimza';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/prisma/seed.js',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
