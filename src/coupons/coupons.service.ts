import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  archiveWhere,
  assertArchivedBeforeDelete,
  type ArchiveFilter,
} from '../common/archive/archive.js';
import type { Coupon } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCouponInput, UpdateCouponInput } from './coupons.schemas.js';

export interface CouponEvaluation {
  isExpired: boolean;
  isNotStarted: boolean;
  isLimitReached: boolean;
  isValid: boolean;
  reason: string | null;
}

export interface SerializedCoupon {
  id: string;
  code: string;
  discountPercent: number;
  customerRange: number;
  uses: number;
  generateDate: string;
  expiredDate: string;
  isActive: boolean;
  isExpired: boolean;
  isNotStarted: boolean;
  isLimitReached: boolean;
  isValid: boolean;
  /** ISO timestamp when archived, or null when live. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponValidationResult {
  valid: boolean;
  message?: string;
  expired?: boolean;
  coupon?: SerializedCoupon;
}

export function getTodayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function evaluateCouponStatus(
  coupon: Pick<
    Coupon,
    'isActive' | 'generateDate' | 'expiredDate' | 'customerRange' | 'uses'
  > & { archivedAt?: Date | null },
  now: Date = new Date(),
): CouponEvaluation {
  const today = getTodayIsoDate(now);
  const isExpired = coupon.expiredDate < today;
  const isNotStarted = coupon.generateDate > today;
  const isLimitReached =
    coupon.customerRange > 0 && coupon.uses >= coupon.customerRange;
  const isArchived = Boolean(coupon.archivedAt);
  const isValid =
    !isArchived && coupon.isActive && !isExpired && !isNotStarted && !isLimitReached;

  let reason: string | null = null;
  if (isArchived) {
    // Archived coupons behave exactly like deleted ones for shoppers.
    reason = 'Invalid coupon code.';
  } else if (!coupon.isActive) {
    reason = 'This coupon is currently inactive.';
  } else if (isExpired) {
    reason = 'This coupon has expired and can no longer be used.';
  } else if (isNotStarted) {
    reason = `This coupon will be active starting ${coupon.generateDate}.`;
  } else if (isLimitReached) {
    reason = 'This coupon has reached its maximum usage limit.';
  }

  return {
    isExpired,
    isNotStarted,
    isLimitReached,
    isValid,
    reason,
  };
}

export function serializeCoupon(
  coupon: Coupon,
  now: Date = new Date(),
): SerializedCoupon {
  const evalStatus = evaluateCouponStatus(coupon, now);
  return {
    id: coupon.id,
    code: coupon.code,
    discountPercent: coupon.discountPercent,
    customerRange: coupon.customerRange,
    uses: coupon.uses,
    generateDate: coupon.generateDate,
    expiredDate: coupon.expiredDate,
    isActive: coupon.isActive,
    isExpired: evalStatus.isExpired,
    isNotStarted: evalStatus.isNotStarted,
    isLimitReached: evalStatus.isLimitReached,
    isValid: evalStatus.isValid,
    archivedAt: coupon.archivedAt ? coupon.archivedAt.toISOString() : null,
    createdAt: coupon.createdAt.toISOString(),
    updatedAt: coupon.updatedAt.toISOString(),
  };
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin list. `archived` = exclude (default) | only | include. */
  async findAll(archived: ArchiveFilter = 'exclude'): Promise<SerializedCoupon[]> {
    const coupons = await this.prisma.coupon.findMany({
      where: archiveWhere(archived),
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return coupons.map((c) => serializeCoupon(c, now));
  }

  async findActive(): Promise<SerializedCoupon[]> {
    const coupons = await this.prisma.coupon.findMany({
      where: { isActive: true, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return coupons
      .map((c) => serializeCoupon(c, now))
      .filter((c) => c.isValid);
  }

  async validateCode(rawCode: string, now: Date = new Date()): Promise<CouponValidationResult> {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      return { valid: false, message: 'Please enter a coupon code.' };
    }

    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon) {
      return { valid: false, message: 'Invalid coupon code.' };
    }

    const evaluation = evaluateCouponStatus(coupon, now);
    if (!evaluation.isValid) {
      return {
        valid: false,
        expired: evaluation.isExpired,
        message: evaluation.reason ?? 'This coupon cannot be used.',
      };
    }

    return {
      valid: true,
      coupon: serializeCoupon(coupon, now),
    };
  }

  async create(input: CreateCouponInput): Promise<SerializedCoupon> {
    const code = input.code.trim().toUpperCase();
    const generateDate = input.generateDate ?? getTodayIsoDate();
    const expiredDate = input.expiredDate;

    if (expiredDate < generateDate) {
      throw new BadRequestException(
        'Expiry date must be on or after the start date.',
      );
    }

    const existing = await this.prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(
        existing.archivedAt
          ? `A coupon with code "${code}" is in the archive. Restore it, or delete it permanently first.`
          : `A coupon with code "${code}" already exists.`,
      );
    }

    const created = await this.prisma.coupon.create({
      data: {
        code,
        discountPercent: input.discountPercent,
        customerRange: input.customerRange ?? 0,
        generateDate,
        expiredDate,
        isActive: input.isActive ?? true,
      },
    });

    return serializeCoupon(created);
  }

  async update(id: string, input: UpdateCouponInput): Promise<SerializedCoupon> {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Coupon not found.');
    }

    const nextCode = input.code ? input.code.trim().toUpperCase() : existing.code;
    const nextStart = input.generateDate ?? existing.generateDate;
    const nextExpiry = input.expiredDate ?? existing.expiredDate;

    if (nextExpiry < nextStart) {
      throw new BadRequestException(
        'Expiry date must be on or after the start date.',
      );
    }

    if (nextCode !== existing.code) {
      const duplicate = await this.prisma.coupon.findUnique({
        where: { code: nextCode },
      });
      if (duplicate) {
        throw new ConflictException(
          duplicate.archivedAt
            ? `A coupon with code "${nextCode}" is in the archive. Restore it, or delete it permanently first.`
            : `A coupon with code "${nextCode}" already exists.`,
        );
      }
    }

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: {
        code: nextCode,
        discountPercent: input.discountPercent ?? existing.discountPercent,
        customerRange: input.customerRange ?? existing.customerRange,
        generateDate: nextStart,
        expiredDate: nextExpiry,
        isActive: input.isActive ?? existing.isActive,
      },
    });

    return serializeCoupon(updated);
  }

  // ---------------------------------------------------------------------------
  // Archive lifecycle: live -> archived -> permanently deleted.
  // Archived coupons are rejected at checkout and hidden from the header promo.
  // ---------------------------------------------------------------------------

  private async findByIdOrThrow(id: string): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found.');
    }
    return coupon;
  }

  async archive(id: string): Promise<SerializedCoupon> {
    const existing = await this.findByIdOrThrow(id);
    if (existing.archivedAt) return serializeCoupon(existing);
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return serializeCoupon(updated);
  }

  async unarchive(id: string): Promise<SerializedCoupon> {
    const existing = await this.findByIdOrThrow(id);
    if (!existing.archivedAt) return serializeCoupon(existing);
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { archivedAt: null },
    });
    return serializeCoupon(updated);
  }

  /** Permanent delete. Throws 409 if the coupon is not archived. */
  async remove(id: string): Promise<{ deleted: true; id: string }> {
    const existing = await this.findByIdOrThrow(id);
    assertArchivedBeforeDelete(existing, `Coupon "${existing.code}"`);

    await this.prisma.coupon.delete({ where: { id } });
    return { deleted: true, id };
  }

  async incrementUsesByCode(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;

    await this.prisma.coupon.updateMany({
      where: { code: normalized },
      data: { uses: { increment: 1 } },
    });
  }
}
