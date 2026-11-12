import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('UsersController', () => {
  let controller: UsersController;
  const mockUsersService = {
    getMe: vi.fn(),
    updateMe: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    setDefaultAddress: vi.fn(),
    removeAddress: vi.fn(),
    requestAccountDeletion: vi.fn(),
    deleteMe: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue('lax') },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return current user profile via getMe', async () => {
    const profile = { id: 'u1', email: 'test@example.com' };
    mockUsersService.getMe.mockResolvedValue(profile);

    const result = await controller.getMe({
      sub: 'u1',
      email: 'test@example.com',
      role: 'CUSTOMER',
    });

    expect(mockUsersService.getMe).toHaveBeenCalledWith('u1');
    expect(result).toEqual(profile);
  });
});
