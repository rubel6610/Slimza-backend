import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { hashPassword } from '../auth/crypto.util.js';
import { PrismaClient, UserRole } from '../generated/prisma/client.js';
import { getDatabaseConnectionConfig } from './db-config.util.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const { poolOptions, connectionString } = getDatabaseConnectionConfig();
    const adapter = new PrismaMariaDb(poolOptions || connectionString);
    super({ adapter });

    this.logger.log(
      `Prisma configured for MySQL at ${poolOptions.host ?? 'localhost'}:${poolOptions.port ?? 3306}/${poolOptions.database ?? 'slimza'} (user: ${poolOptions.user ?? 'anonymous'})`,
    );
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to MySQL via Prisma MariaDB adapter');
    await this.seedAdminIfMissing();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Idempotently seeds the admin user on startup if not already present.
   * If an account with this email already exists, it touches nothing.
   */
  private async seedAdminIfMissing(): Promise<void> {
    const email = (process.env.ADMIN_EMAIL || 'admin@slimza.com').trim().toLowerCase();

    try {
      const existingUser = await this.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        this.logger.log(`Admin account (${email}) already exists. Skipping seed.`);
        return;
      }

      const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
      const passwordHash = await hashPassword(password);
      const name = process.env.ADMIN_NAME || 'Slimza Admin';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      const firstName = parts[0] || 'Admin';
      const lastName = parts.slice(1).join(' ') || '';

      const admin = await this.user.create({
        data: {
          email,
          passwordHash,
          name,
          firstName,
          lastName,
          role: UserRole.ADMIN,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      this.logger.log(`Created default admin account: ${admin.email}`);
    } catch (err) {
      this.logger.warn(`Could not verify/seed admin account: ${(err as Error).message}`);
    }
  }
}
