import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeUser } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateAddressInput,
  UpdateAddressInput,
  UpdateProfileInput,
} from './users.schemas.js';

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
  constructor(private readonly prisma: PrismaService) {}

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

    const avatarsDir = join(process.cwd(), 'uploads', 'avatars');
    await mkdir(avatarsDir, { recursive: true });

    const filename = `${userId}-${Date.now()}.${ext}`;
    const filePath = join(avatarsDir, filename);
    await writeFile(filePath, file.buffer);

    const nextAvatarUrl = `/uploads/avatars/${filename}`;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: nextAvatarUrl },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });

    await this.deleteLocalAvatarIfExists(existing.avatarUrl);
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

    await this.deleteLocalAvatarIfExists(existing.avatarUrl);
    return serializeUser(updated);
  }

  private async deleteLocalAvatarIfExists(avatarUrl: string) {
    if (!avatarUrl.startsWith('/uploads/avatars/')) return;
    const filename = avatarUrl.slice('/uploads/avatars/'.length);
    if (!filename || filename.includes('/') || filename.includes('..')) return;
    try {
      await unlink(join(process.cwd(), 'uploads', 'avatars', filename));
    } catch {
      // File may already be missing; ignore cleanup errors.
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

  async deleteMe(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true as const };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    return users.map(serializeUser);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return serializeUser(user);
  }

  async remove(id: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id } });
    return { ok: true as const };
  }
}
