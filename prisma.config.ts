import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Resolves the MySQL connection URL dynamically for:
 * 1. GoDaddy Platform-Managed Node.js Hosting:
 *    - DB_HOST (e.g. 'localhost' or remote MySQL host)
 *    - DB_NAME
 *    - DB_USER
 *    - DB_PASSWORD
 *    - DB_PORT (defaults to 3306)
 * 2. Explicit DATABASE_URL (local or third-party cloud hosting)
 * 3. Local Docker fallback (root:password@localhost:3306/slimza)
 */
function resolveDatabaseUrl(): string {
  const dbHost = process.env.DB_HOST?.trim();
  const dbName = process.env.DB_NAME?.trim();
  const dbUser = process.env.DB_USER?.trim();
  const dbPassword = process.env.DB_PASSWORD ?? '';
  const dbPort = Number.parseInt(process.env.DB_PORT || '3306', 10) || 3306;

  let url: string;

  if (dbHost && dbName && dbUser) {
    const encodedUser = encodeURIComponent(dbUser);
    const encodedPass = encodeURIComponent(dbPassword);
    const encodedDb = encodeURIComponent(dbName);
    url = `mysql://${encodedUser}:${encodedPass}@${dbHost}:${dbPort}/${encodedDb}`;
  } else if (process.env.DATABASE_URL?.trim()) {
    url = process.env.DATABASE_URL.trim();
  } else {
    url = 'mysql://root:password@localhost:3306/slimza';
  }

  // Ensure process.env.DATABASE_URL is populated for any child tools or scripts
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }

  return url;
}

const datasourceUrl = resolveDatabaseUrl();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/prisma/seed.js',
  },
  datasource: {
    url: datasourceUrl,
  },
});
