import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const mockStorageService = {
    uploadFile: vi.fn(),
    deleteFile: vi.fn().mockResolvedValue({ message: 'ok' }),
  };
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
        { provide: MailService, useValue: { sendAccountDeletedEmail: vi.fn(), sendAccountRestoredEmail: vi.fn() } },
        { provide: StorageService, useValue: mockStorageService },
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

  it('uploads avatar to MinIO and deletes previous MinIO avatar', async () => {
    const existingUser = {
      id: 'u1',
      name: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
      passwordHash: 'secret-hash',
      phone: '',
      birthday: '',
      avatarUrl: 'http://127.0.0.1:9000/slimza-files/avatars/old-avatar.png',
      role: 'CUSTOMER',
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      deletionRequestedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.user.findUnique.mockResolvedValue(existingUser);
    mockStorageService.uploadFile.mockResolvedValue({
      key: 'avatars/new-avatar.png',
      url: 'http://127.0.0.1:9000/slimza-files/avatars/new-avatar.png',
    });
    mockPrisma.user.update.mockResolvedValue({
      ...existingUser,
      avatarUrl: 'http://127.0.0.1:9000/slimza-files/avatars/new-avatar.png',
      addresses: [],
    });

    const file = {
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
      originalname: 'photo.png',
      size: 100,
    };
    const result = await service.updateAvatar('u1', file);

    expect(mockStorageService.uploadFile).toHaveBeenCalledWith(file, 'avatars');
    expect(result.avatarUrl).toBe('http://127.0.0.1:9000/slimza-files/avatars/new-avatar.png');
    expect(mockStorageService.deleteFile).toHaveBeenCalledWith('avatars/old-avatar.png');
  });

  it('removes avatar from MinIO on removeAvatar', async () => {
    const existingUser = {
      id: 'u1',
      name: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
      passwordHash: 'secret-hash',
      phone: '',
      birthday: '',
      avatarUrl: 'http://127.0.0.1:9000/slimza-files/avatars/old-avatar.png',
      role: 'CUSTOMER',
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      deletionRequestedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.user.findUnique.mockResolvedValue(existingUser);
    mockPrisma.user.update.mockResolvedValue({
      ...existingUser,
      avatarUrl: '',
      addresses: [],
    });

    const result = await service.removeAvatar('u1');

    expect(result.avatarUrl).toBe('');
    expect(mockStorageService.deleteFile).toHaveBeenCalledWith('avatars/old-avatar.png');
  });
});
