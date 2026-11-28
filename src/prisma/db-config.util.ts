export type MariaDbPoolConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  connectTimeout?: number;
  acquireTimeout?: number;
  ssl?: boolean | object;
  allowPublicKeyRetrieval?: boolean;
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
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || undefined;
    const allowPublicKeyRetrieval = parsed.searchParams.has('allowPublicKeyRetrieval')
      ? parsed.searchParams.get('allowPublicKeyRetrieval') !== 'false'
      : process.env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL !== 'false';

    return {
      host,
      port,
      user: user || undefined,
      password: password || undefined,
      database,
      connectionLimit: Number.parseInt(process.env.DB_POOL_LIMIT || '10', 10) || 10,
      connectTimeout: Number.parseInt(process.env.DB_CONNECT_TIMEOUT || '15000', 10) || 15000,
      acquireTimeout: Number.parseInt(process.env.DB_ACQUIRE_TIMEOUT || '15000', 10) || 15000,
      ssl: process.env.DB_SSL === 'true' ? true : undefined,
      allowPublicKeyRetrieval,
    };
  } catch (err) {
    throw new Error(`Failed to parse database connection URL: ${(err as Error).message}`);
  }
}

/**
 * Builds a standardized MySQL connection string and PoolConfig.
 *
 * Supported environments:
 * 1. GoDaddy Platform-Managed Node.js Hosting variables:
 *    - DB_HOST (e.g. 'localhost' or remote database host)
 *    - DB_NAME
 *    - DB_USER
 *    - DB_PASSWORD
 *    - DB_PORT (defaults to 3306)
 * 2. Explicit DATABASE_URL (mysql://user:pass@host:3306/dbname)
 * 3. Local fallback (mysql://root:password@localhost:3306/slimza)
 */
export function getDatabaseConnectionConfig(): DatabaseConnectionConfig {
  const dbHost = process.env.DB_HOST?.trim();
  const dbName = process.env.DB_NAME?.trim();
  const dbUser = process.env.DB_USER?.trim();
  const dbPassword = process.env.DB_PASSWORD ?? '';
  const dbPort = Number.parseInt(process.env.DB_PORT || '3306', 10) || 3306;
  const allowPublicKeyRetrieval = process.env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL !== 'false';

  let connectionString: string;
  let poolOptions: MariaDbPoolConfig;

  if (dbHost && dbName && dbUser) {
    const encodedUser = encodeURIComponent(dbUser);
    const encodedPass = encodeURIComponent(dbPassword);
    const encodedDb = encodeURIComponent(dbName);
    const pubKeyParam = allowPublicKeyRetrieval ? '?allowPublicKeyRetrieval=true' : '';
    connectionString = `mysql://${encodedUser}:${encodedPass}@${dbHost}:${dbPort}/${encodedDb}${pubKeyParam}`;

    poolOptions = {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      connectionLimit: Number.parseInt(process.env.DB_POOL_LIMIT || '10', 10) || 10,
      connectTimeout: Number.parseInt(process.env.DB_CONNECT_TIMEOUT || '15000', 10) || 15000,
      acquireTimeout: Number.parseInt(process.env.DB_ACQUIRE_TIMEOUT || '15000', 10) || 15000,
      ssl: process.env.DB_SSL === 'true' ? true : undefined,
      allowPublicKeyRetrieval,
    };
  } else if (process.env.DATABASE_URL?.trim()) {
    connectionString = process.env.DATABASE_URL.trim();
    poolOptions = parseDatabaseUrl(connectionString);
  } else {
    connectionString = 'mysql://root:password@localhost:3306/slimza?allowPublicKeyRetrieval=true';
    poolOptions = {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'slimza',
      connectionLimit: 10,
      connectTimeout: 15000,
      acquireTimeout: 15000,
      allowPublicKeyRetrieval: true,
    };
  }

  // Ensure process.env.DATABASE_URL is populated
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = connectionString;
  }

  return { connectionString, poolOptions };
}
