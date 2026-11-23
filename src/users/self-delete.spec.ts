import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../auth/crypto.util.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import { getAccountBlock } from './account-access.js';
import { deleteMyAccountSchema } from './users.schemas.js';
import { UsersService } from './users.service.js';

async function setup(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'u1',
    email: 'sam@example.com',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    passwordHash: await hashPassword('correct-horse'),
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...user, ...data, addresses: [] })),
      delete: vi.fn(),
    },
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const mail = { sendAccountDeletedEmail: vi.fn().mockResolvedValue(undefined), sendAccountRestoredEmail: vi.fn().mockResolvedValue(undefined) };
  return { service: new UsersService(prisma as never, {} as never, mail as never), prisma, user, mail };
}

describe('customer deletes their own account (soft delete)', () => {
  it('archives + marks deletedAt, keeps the row, and signs them out everywhere', async () => {
    const { service, prisma } = await setup();
    const res = await service.deleteMe('u1', { password: 'correct-horse', reason: 'Too many emails' });

    expect(res.ok).toBe(true);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.archivedAt).toBe(data.deletedAt);
    expect(data.deletionReason).toBe('Too many emails');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
  });

  it('emails the customer on delete and on restore', async () => {
    const deleted = await setup({ firstName: 'Sam' });
    await deleted.service.deleteMe('u1', { password: 'correct-horse', reason: '' });
    expect(deleted.mail.sendAccountDeletedEmail).toHaveBeenCalledWith({ to: 'sam@example.com', name: 'Sam' });

    const at = new Date();
    const restored = await setup({ firstName: 'Sam', archivedAt: at, deletedAt: at });
    await restored.service.unarchive('u1', 'admin-1');
    expect(restored.mail.sendAccountRestoredEmail).toHaveBeenCalledWith({ to: 'sam@example.com', name: 'Sam' });
  });

  it('needs the right password', async () => {
    const { service, prisma } = await setup();
    await expect(service.deleteMe('u1', { password: 'wrong', reason: '' })).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('never deletes admin accounts this way', async () => {
    const { service } = await setup({ role: UserRole.ADMIN });
    await expect(service.deleteMe('u1', { password: 'correct-horse', reason: '' })).rejects.toThrow(ForbiddenException);
  });

  it('blocks sign-in with a "contact us to restore" message', () => {
    const block = getAccountBlock({ status: UserStatus.ACTIVE, archivedAt: new Date(), deletedAt: new Date() });
    expect(block?.code).toBe('ACCOUNT_ARCHIVED');
    expect(block?.message).toBe('Your account has been deleted. If you want your account back, please contact info@slimza.com.');
  });

  it('an admin restore brings the account back', async () => {
    const at = new Date();
    const { service, prisma } = await setup({ archivedAt: at, deletedAt: at, deletionReason: 'x' });
    await service.unarchive('u1', 'admin-1');
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      archivedAt: null,
      deletedAt: null,
      deletionReason: null,
      deletionRequestedAt: null,
    });
  });

  it('validates the request body', () => {
    expect(deleteMyAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteMyAccountSchema.parse({ password: 'x' })).toEqual({ password: 'x', reason: '' });
  });
});
