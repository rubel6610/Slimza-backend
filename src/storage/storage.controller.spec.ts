import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

describe('StorageController', () => {
  let controller: StorageController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: StorageService,
          useValue: {
            uploadFile: vi.fn(),
            deleteFile: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<StorageController>(StorageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
