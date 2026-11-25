import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  archiveWhere,
  assertArchivedBeforeDelete,
} from '../common/archive/archive.js';
import { paginate, searchWhere, toOrderBy } from '../common/pagination/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import { serializeUser } from '../auth/auth.service.js';
import { verifyPassword } from '../auth/crypto.util.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  DeleteMyAccountInput,
  AdminUsersPageQuery,
  AdminUsersQuery,
  CreateAddressInput,
  UpdateAddressInput,
  UpdateProfileInput,
} from './users.schemas.js';
import { StorageService } from '../storage/storage.service.js';

export interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return serializeUser(user);
  }

  async updateMe(userId: string, input: UpdateProfileInput) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existing) throw new NotFoundException('User not found');

    if (input.email && input.email !== existing.email) {
      const emailTaken = await this.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (emailTaken) {
        throw new ConflictException('That email is already in use');
      }
    }

    const nextFirstName = input.firstName ?? existing.firstName;
    const nextLastName = input.lastName ?? existing.lastName;
    const derivedName =
      input.name ??
      ([nextFirstName, nextLastName].filter(Boolean).join(' ').trim() ||
        existing.name);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: nextFirstName,
        lastName: nextLastName,
        name: derivedName,
        email: input.email ?? existing.email,
        phone: input.phone ?? existing.phone,
        birthday: input.birthday ?? existing.birthday,
        avatarUrl: input.avatarUrl ?? existing.avatarUrl,
      },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });

    return serializeUser(updated);
  }

  async updateAvatar(userId: string, file?: UploadedAvatarFile) {
    if (!file) {
      throw new BadRequestException('Please choose an image file to upload');
    }

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Only JPEG, PNG, WEBP, or GIF images are allowed',
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Profile picture must be 5MB or smaller');
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existing) throw new NotFoundException('User not found');

    const { url: nextAvatarUrl } = await this.storageService.uploadFile(
      file,
      'avatars',
    );

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: nextAvatarUrl },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });

    await this.deleteAvatarIfExists(existing.avatarUrl);
    return serializeUser(updated);
  }

  async removeAvatar(userId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existing) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: '' },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });

    await this.deleteAvatarIfExists(existing.avatarUrl);
    return serializeUser(updated);
  }

  private async deleteAvatarIfExists(avatarUrl: string) {
    if (!avatarUrl) return;

    const marker = 'avatars/';
    const idx = avatarUrl.indexOf(marker);
    if (idx !== -1) {
      const key = avatarUrl.slice(idx).split('?')[0].split('#')[0];
      await this.storageService.deleteFile(key).catch((err) => {
        this.logger.warn(
          `Failed to delete old MinIO avatar "${key}": ${String(err)}`,
        );
      });
    }
  }

  async addAddress(userId: string, input: CreateAddressInput) {
    const count = await this.prisma.address.count({ where: { userId } });
    const shouldBeDefault = input.isDefault ?? count === 0;

    return this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId,
          label: input.label || 'Address',
          name: input.name,
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          district: input.district ?? '',
          postcode: input.postcode,
          country: input.country,
          phone: input.phone ?? '',
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpdateAddressInput,
  ) {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id: addressId },
        data: {
          label: input.label ?? existing.label,
          name: input.name ?? existing.name,
          line1: input.line1 ?? existing.line1,
          line2: input.line2 !== undefined ? input.line2 || null : existing.line2,
          city: input.city ?? existing.city,
          district: input.district ?? existing.district,
          postcode: input.postcode ?? existing.postcode,
          country: input.country ?? existing.country,
          phone: input.phone ?? existing.phone,
          isDefault: input.isDefault ?? existing.isDefault,
        },
      });
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');

    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ]);

    return this.getMe(userId);
  }

  async removeAddress(userId: string, addressId: string) {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: addressId } });
      if (existing.isDefault) {
        const nextAddress = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (nextAddress) {
          await tx.address.update({
            where: { id: nextAddress.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return this.getMe(userId);
  }

  async requestAccountDeletion(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date() },
    });
    return {
      ok: true as const,
      message:
        "We've received your request. Our team will confirm by email before anything is deleted.",
    };
  }

  /**
   * The customer deletes their own account (Account → Settings). This is a SOFT delete:
   * the account is archived and marked `deletedAt`, so it is blocked everywhere and the
   * customer is signed out, but orders, points and reviews are kept and an admin can
   * restore it (Dashboard → Users → Archived → Restore). Permanent deletion stays an
   * admin action (`remove`). Admin accounts can't be deleted this way.
   */
  async deleteMe(userId: string, input: DeleteMyAccountInput) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin accounts cannot be deleted from account settings.');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new BadRequestException('Your password is incorrect');
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        deletedAt: now,
        archivedAt: user.archivedAt ?? now,
        deletionReason: input.reason || null,
      },
    });
    await this.revokeSessions(user.id);
    void this.mailService.sendAccountDeletedEmail({ to: user.email, name: user.firstName || user.name });
    this.logger.warn(`User ${user.email} deleted their account${input.reason ? ` (reason: ${input.reason})` : ''}`);
    return {
      ok: true as const,
      message: "Your account has been deleted. If you change your mind, contact us and we can restore it.",
    };
  }

  // ===========================================================================
  // Admin: user list + account status + archive lifecycle.
  // Rules: src/users/account-access.ts and src/common/archive/archive.ts
  // ===========================================================================

  private readonly withAddresses = {
    addresses: { orderBy: [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }] },
  };

  /** Admin list. Defaults to live (non-archived) users of any status. */
  async findAll(query: Partial<AdminUsersQuery> = {}) {
    const users = await this.prisma.user.findMany({
      where: {
        ...archiveWhere(query.archived),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.withAddresses,
    });
    return users.map(serializeUser);
  }

  /**
   * Paginated, searchable, sortable user list — the worked example of
   * src/common/pagination/pagination.ts. Read top to bottom:
   */
  async findPage(query: AdminUsersPageQuery) {
    // 1. Filters → one Prisma `where`. Each piece is {} when not used, so spreading is safe.
    const where: Prisma.UserWhereInput = {
      ...archiveWhere(query.archived),
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...searchWhere(query.q, ['name', 'email', 'phone']),
    };

    // 2. Count + fetch the page together; the same `where` is used for both,
    //    so `total` always matches what the pages contain.
    const result = await paginate(query, {
      count: () => this.prisma.user.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.user.findMany({
          where,
          orderBy: toOrderBy(query.sort),
          skip,
          take,
          include: this.withAddresses,
        }),
    });

    // 3. Never send raw rows (password hashes!) — serialise like every other endpoint.
    return { ...result, items: result.items.map(serializeUser) };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: this.withAddresses,
    });
    if (!user) throw new NotFoundException('User not found');
    return serializeUser(user);
  }

  /**
   * Loads the target of an admin action and refuses actions that could lock
   * the shop out: admins can't act on themselves or on other admin accounts.
   */
  private async findManageableUser(id: string, actingAdminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actingAdminId) {
      throw new ForbiddenException('You cannot suspend, archive or delete your own account.');
    }
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin accounts cannot be suspended, archived or deleted.');
    }
    return user;
  }

  /** Signs the user out everywhere (their refresh tokens stop working). */
  private async revokeSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Suspend: the user can't sign in, buy, pay or use the account. Reversible. */
  async suspend(id: string, actingAdminId: string, reason?: string) {
    const user = await this.findManageableUser(id, actingAdminId);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.SUSPENDED,
        suspendedAt: user.status === UserStatus.SUSPENDED ? user.suspendedAt : new Date(),
        suspensionReason: reason?.trim() || null,
      },
      include: this.withAddresses,
    });
    await this.revokeSessions(user.id);
    this.logger.warn(`Suspended user ${user.email}${reason ? ` (${reason})` : ''}`);
    return serializeUser(updated);
  }

  /** Activate: lift a suspension. */
  async activate(id: string, actingAdminId: string) {
    const user = await this.findManageableUser(id, actingAdminId);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE, suspendedAt: null, suspensionReason: null },
      include: this.withAddresses,
    });
    this.logger.log(`Activated user ${user.email}`);
    return serializeUser(updated);
  }

  /** Archive: hide from the users list and block the account. Restorable. */
  async archive(id: string, actingAdminId: string) {
    const user = await this.findManageableUser(id, actingAdminId);
    if (user.archivedAt) return this.findOne(user.id);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { archivedAt: new Date() },
      include: this.withAddresses,
    });
    await this.revokeSessions(user.id);
    this.logger.warn(`Archived user ${user.email}`);
    return serializeUser(updated);
  }

  /**
   * Restore from the archive. A suspended user stays suspended. Also recovers an
   * account the customer deleted themselves: they can sign in again with their old password.
   */
  async unarchive(id: string, actingAdminId: string) {
    const user = await this.findManageableUser(id, actingAdminId);
    if (!user.archivedAt) return this.findOne(user.id);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { archivedAt: null, deletedAt: null, deletionReason: null, deletionRequestedAt: null },
      include: this.withAddresses,
    });
    this.logger.log(`Restored user ${user.email}${user.deletedAt ? ' (had deleted their own account)' : ''}`);
    void this.mailService.sendAccountRestoredEmail({ to: user.email, name: user.firstName || user.name });
    return serializeUser(updated);
  }

  /**
   * Permanent delete (archived users only, 409 otherwise). Addresses and
   * sessions are deleted with the user; their orders are kept with `userId = null`.
   */
  async remove(id: string, actingAdminId: string) {
    const user = await this.findManageableUser(id, actingAdminId);
    assertArchivedBeforeDelete(user, `User ${user.email}`);
    await this.prisma.user.delete({ where: { id: user.id } });
    await this.deleteAvatarIfExists(user.avatarUrl);
    this.logger.warn(`Permanently deleted user ${user.email}`);
    return { ok: true as const };
  }
}
