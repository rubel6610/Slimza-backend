import type { PrismaMariaDb } from '@prisma/adapter-mariadb';

export type MariaDbPoolConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  connectTimeout?: number;
};

export interface DatabaseConnectionConfig {
  connectionString: string;
  poolOptions: MariaDbPoolConfig;
}

/**
 * Parses a standard mysql:// or mariadb:// connection URL into discrete connection options.
 */
export function parseDatabaseUrl(rawUrl: string): MariaDbPoolConfig {
  try {
    const normalized = rawUrl.replace(/^(mysql|mariadb):/, 'http:');
    const parsed = new URL(normalized);

    const user = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    const host = parsed.hostname || 'localhost';
    const port = Number.parseInt(parsed.port || '3306', 10) || 3306;
    const database = parsed.pathname.replace(/^\//, '') || undefined;

    return {
      host,
      port,
      user: user || undefined,
      password: password || undefined,
      database,
      connectionLimit: Number.parseInt(process.env.DB_POOL_LIMIT || '10', 10) || 10,
      connectTimeout: 15000,
    };
  } catch (err) {
    throw new Error(`Failed to parse database connection URL: ${(err as Error).message}`);
  }
}

/**
 * Builds a standardized MySQL connection string and PoolConfig.
 *
 * Supported environments:
 * 1. GoDaddy Node.js Hosting variables:
 *    - DB_HOST (defaults to 'localhost')
 *    - DB_PORT (defaults to 3306)
 *    - DB_NAME
 *    - DB_USER
 *    - DB_PASSWORD
 * 2. Explicit DATABASE_URL (mysql://user:pass@host:3306/dbname)
 */
export function getDatabaseConnectionConfig(): DatabaseConnectionConfig {
  const dbHost = process.env.DB_HOST?.trim();
  const dbName = process.env.DB_NAME?.trim();
  const dbUser = process.env.DB_USER?.trim();
  const dbPassword = process.env.DB_PASSWORD ?? '';
  const dbPort = Number.parseInt(process.env.DB_PORT || '3306', 10) || 3306;

  let connectionString: string;
  let poolOptions: MariaDbPoolConfig;

  if (dbHost && dbName && dbUser) {
    const encodedUser = encodeURIComponent(dbUser);
    const encodedPass = encodeURIComponent(dbPassword);
    connectionString = `mysql://${encodedUser}:${encodedPass}@${dbHost}:${dbPort}/${dbName}`;

    poolOptions = {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      connectionLimit: Number.parseInt(process.env.DB_POOL_LIMIT || '10', 10) || 10,
      connectTimeout: 15000,
    };
  } else if (process.env.DATABASE_URL?.trim()) {
    connectionString = process.env.DATABASE_URL.trim();
    poolOptions = parseDatabaseUrl(connectionString);
  } else {
    connectionString = 'mysql://root:password@localhost:3306/slimza';
    poolOptions = {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'slimza',
      connectionLimit: 10,
    };
  }

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = connectionString;
  }

  return { connectionString, poolOptions };
}
