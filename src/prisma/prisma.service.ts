import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
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
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
