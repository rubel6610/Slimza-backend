import { Controller, Get } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';

@Controller('redis')
export class RedisController {
  constructor(private readonly redisService: RedisService) {

  }

  @Get('ping')
  async ping() {
    return this.redisService.client.ping();
  }
}
