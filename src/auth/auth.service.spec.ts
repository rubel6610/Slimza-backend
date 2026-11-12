import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { hashPassword, hashToken } from './crypto.util.js';

describe('AuthService', () => {
  let service: AuthService;
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    otpCode: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      if (typeof ops === 'function') return ops(mockPrisma);
      return ops;
    }),
  };

  const mockMailService = {
    sendOtpEmail: vi.fn(),
  };

  const mockJwtService = {
    signAsync: vi.fn().mockResolvedValue('signed-access-jwt'),
    verifyAsync: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              const map: Record<string, string> = {
                JWT_ACCESS_SECRET: 'test-access-secret',
                JWT_ACCESS_EXPIRES_IN: '15m',
                JWT_REFRESH_EXPIRES_DAYS: '30',
                JWT_SHORT_REFRESH_EXPIRES_DAYS: '1',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('rejects duplicate verified email during register', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'alex@example.com',
      isEmailVerified: true,
    });

    await expect(
      service.register({
        name: 'Alex Morgan',
        email: 'alex@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('registers user and sends 6-digit signup OTP', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'u1',
      name: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
    });
    mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp1' });

    const res = await service.register({
      name: 'Alex Morgan',
      email: 'alex@example.com',
      password: 'password123',
    });

    expect(res.ok).toBe(true);
    expect(mockMailService.sendOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alex@example.com',
        purpose: 'signup',
        code: expect.stringMatching(/^\d{6}$/),
      }),
    );
  });

  it('verifies signup code and marks user verified', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp1',
      userId: 'u1',
      email: 'alex@example.com',
      codeHash: hashToken('123456'),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.otpCode.update.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});

    const res = await service.verifyCode({
      email: 'alex@example.com',
      code: '123456',
      purpose: 'signup',
    });

    expect(res).toEqual({
      ok: true,
      message: 'Email verified successfully',
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({ isEmailVerified: true }),
    });
  });

  it('rejects invalid OTP code and increments attempts', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp1',
      userId: 'u1',
      email: 'alex@example.com',
      codeHash: hashToken('123456'),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyCode({
        email: 'alex@example.com',
        code: '999999',
        purpose: 'signup',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('blocks login for unverified user', async () => {
    const passwordHash = await hashPassword('password123');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
      passwordHash,
      isEmailVerified: false,
      addresses: [],
    });

    await expect(
      service.signIn(
        { email: 'alex@example.com', password: 'password123', remember: true },
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('issues tokens and returns safe user on verified signIn', async () => {
    const passwordHash = await hashPassword('password123');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
      passwordHash,
      phone: '',
      birthday: '',
      role: 'CUSTOMER',
      isEmailVerified: true,
      deletionRequestedAt: null,
      createdAt: new Date(),
      addresses: [],
    });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

    const res = await service.signIn(
      { email: 'alex@example.com', password: 'password123', remember: true },
      {},
    );

    expect(res.ok).toBe(true);
    expect(res.accessToken).toBe('signed-access-jwt');
    expect(res.refreshToken).toBeTruthy();
    expect(res.user.email).toBe('alex@example.com');
  });
});
