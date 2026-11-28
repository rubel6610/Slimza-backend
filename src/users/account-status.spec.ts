import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator.js';
import { ALLOW_BLOCKED_ACCOUNT_KEY } from '../auth/decorators/allow-blocked-account.decorator.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import { getAccountBlock } from './account-access.js';
import { UsersService } from './users.service.js';

const ACTIVE = { status: UserStatus.ACTIVE, archivedAt: null, suspensionReason: null };
const SUSPENDED = { status: UserStatus.SUSPENDED, archivedAt: null, suspensionReason: 'Fraud check' };
const ARCHIVED = { status: UserStatus.ACTIVE, archivedAt: new Date(), suspensionReason: null };

describe('getAccountBlock', () => {
  it('allows active accounts', () => {
    expect(getAccountBlock(ACTIVE)).toBeNull();
  });
  it('blocks suspended accounts and includes the reason', () => {
    expect(getAccountBlock(SUSPENDED)).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      message: expect.stringContaining('Fraud check'),
    });
  });
  it('blocks archived accounts (archive wins over status)', () => {
    expect(getAccountBlock({ ...SUSPENDED, archivedAt: new Date() })?.code).toBe('ACCOUNT_ARCHIVED');
    expect(getAccountBlock(ARCHIVED)?.code).toBe('ACCOUNT_ARCHIVED');
  });
});

describe('JwtAuthGuard account status check', () => {
  const findUnique = vi.fn();
  const meta: Record<string, boolean> = {};
  let guard: JwtAuthGuard;

  const ctx = (method: string) => {
    const request: Record<string, unknown> = { method, headers: { authorization: 'Bearer t' }, cookies: {} };
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    for (const key of Object.keys(meta)) delete meta[key];
    findUnique.mockReset();
    const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'u1', email: 'a@b.c', role: 'CUSTOMER' }) };
    const config = { get: () => 'secret' };
    guard = new JwtAuthGuard(jwt as never, reflector, config as never, { user: { findUnique } } as never);
  });

  it('lets active users through', async () => {
    findUnique.mockResolvedValue(ACTIVE);
    const { context, request } = ctx('POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeDefined();
  });

  it('refuses suspended users on protected routes', async () => {
    findUnique.mockResolvedValue(SUSPENDED);
    await expect(guard.canActivate(ctx('GET').context)).rejects.toThrow(ForbiddenException);
  });

  it('refuses suspended users on public actions (e.g. checkout POST)', async () => {
    meta[IS_PUBLIC_KEY] = true;
    findUnique.mockResolvedValue(SUSPENDED);
    await expect(guard.canActivate(ctx('POST').context)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_SUSPENDED' },
    });
  });

  it('lets suspended users browse public pages, as a guest', async () => {
    meta[IS_PUBLIC_KEY] = true;
    findUnique.mockResolvedValue(SUSPENDED);
    const { context, request } = ctx('GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('skips the check on @AllowBlockedAccount routes (logout, login)', async () => {
    meta[IS_PUBLIC_KEY] = true;
    meta[ALLOW_BLOCKED_ACCOUNT_KEY] = true;
    findUnique.mockResolvedValue(SUSPENDED);
    await expect(guard.canActivate(ctx('POST').context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('treats a deleted user as signed out', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx('GET').context)).rejects.toThrow(UnauthorizedException);
  });
});

describe('UsersService admin account actions', () => {
  const customer = { id: 'c1', email: 'c@x.com', role: UserRole.CUSTOMER, ...ACTIVE, suspendedAt: null };
  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(customer),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...customer, ...data, addresses: [] })),
        delete: vi.fn().mockResolvedValue(customer),
      },
      refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    service = new UsersService(
      prisma,
      { sendAccountDeletedEmail: vi.fn(), sendAccountRestoredEmail: vi.fn() } as never,
      { uploadFile: vi.fn(), deleteFile: vi.fn().mockResolvedValue({ message: 'ok' }) } as never,
    );
  });

  it('suspends with a reason and signs the user out everywhere', async () => {
    const result = await service.suspend('c1', 'admin-1', 'Chargeback');
    expect(result.status).toBe(UserStatus.SUSPENDED);
    expect(result.suspensionReason).toBe('Chargeback');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'c1', revokedAt: null } }),
    );
  });

  it('activates (clears suspension)', async () => {
    const result = await service.activate('c1', 'admin-1');
    expect(result).toMatchObject({ status: UserStatus.ACTIVE, suspensionReason: null });
  });

  it('refuses to act on yourself or on admins', async () => {
    await expect(service.suspend('c1', 'c1')).rejects.toThrow(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue({ ...customer, role: UserRole.ADMIN });
    await expect(service.archive('c1', 'admin-1')).rejects.toThrow(ForbiddenException);
  });

  it('only deletes archived users', async () => {
    await expect(service.remove('c1', 'admin-1')).rejects.toThrow(ConflictException);
    prisma.user.findUnique.mockResolvedValue({ ...customer, archivedAt: new Date() });
    await expect(service.remove('c1', 'admin-1')).resolves.toEqual({ ok: true });
    expect(prisma.user.delete).toHaveBeenCalled();
  });
});
