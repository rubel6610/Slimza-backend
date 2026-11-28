import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { RedisController } from './redis.controller.js';
import { RedisService } from './redis.service.js';

describe('RedisController', () => {
  let controller: RedisController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedisController],
      providers: [
        {
          provide: RedisService,
          useValue: {
            client: { ping: vi.fn().mockResolvedValue('PONG') },
          },
        },
      ],
    }).compile();

    controller = module.get<RedisController>(RedisController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
