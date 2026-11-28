import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CouponsService } from './coupons.service.js';

describe('CouponsService', () => {
  let service: CouponsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      coupon: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    };

    service = new CouponsService(mockPrisma as unknown as PrismaService);
  });

  it('validates an active, non-expired coupon', async () => {
    const now = new Date('2026-11-18T10:00:00Z');
    mockPrisma.coupon.findUnique.mockResolvedValue({
      id: 'c1',
      code: 'SAVE20',
      discountPercent: 20,
      customerRange: 50,
      uses: 10,
      generateDate: '2026-11-01',
      expiredDate: '2026-12-31',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const res = await service.validateCode('save20', now);
    expect(res.valid).toBe(true);
    expect(res.coupon?.code).toBe('SAVE20');
    expect(res.coupon?.discountPercent).toBe(20);
    expect(res.coupon?.isExpired).toBe(false);
  });

  it('rejects an expired coupon', async () => {
    const now = new Date('2026-11-18T10:00:00Z');
    mockPrisma.coupon.findUnique.mockResolvedValue({
      id: 'c2',
      code: 'OLD15',
      discountPercent: 15,
      customerRange: 100,
      uses: 2,
      generateDate: '2026-01-01',
      expiredDate: '2026-11-17',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const res = await service.validateCode('OLD15', now);
    expect(res.valid).toBe(false);
    expect(res.expired).toBe(true);
    expect(res.message).toMatch(/expired/i);
  });

  it('rejects a coupon that reached its usage limit', async () => {
    const now = new Date('2026-11-18T10:00:00Z');
    mockPrisma.coupon.findUnique.mockResolvedValue({
      id: 'c3',
      code: 'LIMIT10',
      discountPercent: 10,
      customerRange: 10,
      uses: 10,
      generateDate: '2026-11-01',
      expiredDate: '2026-12-31',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const res = await service.validateCode('LIMIT10', now);
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/usage limit/i);
  });

  it('allows unlimited uses when customerRange is 0', async () => {
    const now = new Date('2026-11-18T10:00:00Z');
    mockPrisma.coupon.findUnique.mockResolvedValue({
      id: 'c-unlim',
      code: 'UNLIMITED25',
      discountPercent: 25,
      customerRange: 0,
      uses: 5000,
      generateDate: '2026-11-01',
      expiredDate: '2026-12-31',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const res = await service.validateCode('UNLIMITED25', now);
    expect(res.valid).toBe(true);
    expect(res.coupon?.isLimitReached).toBe(false);
    expect(res.coupon?.customerRange).toBe(0);
  });

  it('rejects creating duplicate coupon code', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({ id: 'existing', code: 'DUP10' });

    await expect(
      service.create({
        code: 'DUP10',
        discountPercent: 10,
        customerRange: 50,
        generateDate: '2026-11-18',
        expiredDate: '2026-12-31',
        isActive: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects creating coupon with expiry before start date', async () => {
    await expect(
      service.create({
        code: 'BADDATE',
        discountPercent: 10,
        customerRange: 50,
        generateDate: '2026-12-01',
        expiredDate: '2026-11-01',
        isActive: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
