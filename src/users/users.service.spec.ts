import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    address: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return serialized user without passwordHash on getMe', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
      passwordHash: 'secret-hash',
      phone: '',
      birthday: '',
      avatarUrl: '',
      role: 'CUSTOMER',
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      deletionRequestedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      addresses: [],
    });

    const result = await service.getMe('u1');
    expect(result.email).toBe('alex@example.com');
    expect('passwordHash' in result).toBe(false);
  });

  it('rejects unsupported avatar mime types', async () => {
    await expect(
      service.updateAvatar('u1', {
        buffer: Buffer.from('hello'),
        mimetype: 'text/plain',
        originalname: 'note.txt',
        size: 5,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
