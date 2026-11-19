import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  archiveWhere,
  assertArchivedBeforeDelete,
} from '../common/archive/archive.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateFranchiseApplicationInput,
  FranchiseListQuery,
  UpdateFranchiseApplicationInput,
} from './franchise.schemas.js';

/**
 * "Franchise with us" applications.
 *
 * Flow: a visitor submits the public form → status NEW → an admin reviews it in
 * Dashboard → Franchise (CONTACTED / APPROVED / REJECTED, internal note) →
 * archive → restore or delete forever (src/common/archive/archive.ts).
 */
@Injectable()
export class FranchiseService {
  private readonly logger = new Logger(FranchiseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Public submit. Emails the admin and the applicant without blocking the response. */
  async create(input: CreateFranchiseApplicationInput) {
    // Honeypot filled → pretend it worked, store nothing.
    if (input._gotcha.trim()) {
      this.logger.warn(`Dropped franchise application from ${input.email}`);
      return { ok: true as const };
    }

    const application = await this.prisma.franchiseApplication.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        businessName: input.businessName || null,
        country: input.country,
        location: input.location,
        interest: input.interest,
        channel: input.channel,
        message: input.message || null,
      },
    });
    this.logger.log(`New franchise application from ${application.email} (${application.country})`);

    void this.mail.sendFranchiseApplicationEmails(application).catch((err: unknown) => {
      this.logger.warn(`Franchise emails failed for ${application.id}: ${String(err)}`);
    });

    return { ok: true as const, id: application.id };
  }

  /** Admin list, newest first. Defaults to live (non-archived) applications. */
  findAll(query: Partial<FranchiseListQuery> = {}) {
    return this.prisma.franchiseApplication.findMany({
      where: {
        ...archiveWhere(query.archived),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findOrThrow(id: string) {
    const application = await this.prisma.franchiseApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Franchise application not found');
    return application;
  }

  async update(id: string, input: UpdateFranchiseApplicationInput) {
    await this.findOrThrow(id);
    return this.prisma.franchiseApplication.update({
      where: { id },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.adminNote !== undefined && { adminNote: input.adminNote || null }),
      },
    });
  }

  // ---- Archive lifecycle -----------------------------------------------------

  async archive(id: string) {
    const existing = await this.findOrThrow(id);
    if (existing.archivedAt) return existing;
    return this.prisma.franchiseApplication.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async unarchive(id: string) {
    const existing = await this.findOrThrow(id);
    if (!existing.archivedAt) return existing;
    return this.prisma.franchiseApplication.update({
      where: { id },
      data: { archivedAt: null },
    });
  }

  /** Permanent. 409 unless the application is archived. */
  async remove(id: string) {
    const existing = await this.findOrThrow(id);
    assertArchivedBeforeDelete(existing, `Application from ${existing.fullName}`);
    await this.prisma.franchiseApplication.delete({ where: { id } });
    return { ok: true as const };
  }
}
