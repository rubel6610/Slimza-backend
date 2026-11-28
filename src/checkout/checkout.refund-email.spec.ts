import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

describe('CheckoutService — refund email', () => {
  it('emails the customer whenever a refund is approved', async () => {
    const order = { id: 'o1', orderNumber: 'SLZ-1', customerEmail: 'sam@example.com', customerName: 'Sam', total: 32.98, paymentMode: 'demo', paymentIntentId: null, paymentStatus: 'PAID', items: [] };
    const refund = { id: 'r1', status: 'REQUESTED', order };
    const prisma = {
      refundRequest: { findUnique: vi.fn().mockResolvedValue(refund), update: vi.fn().mockReturnValue('refund-update') },
      order: { update: vi.fn().mockReturnValue('order-update') },
      $transaction: vi.fn().mockResolvedValue([{ ...refund, status: 'REFUNDED', order }]),
    };
    const mail = { sendRefundEmail: vi.fn().mockResolvedValue(undefined) };
    const service = new CheckoutService(prisma as unknown as PrismaService, { get: vi.fn(() => null) } as unknown as ConfigService, mail as unknown as MailService);

    await service.processRefund('r1', { action: 'APPROVE_REFUND', adminNote: 'Sorry!' });
    expect(mail.sendRefundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sam@example.com', name: 'Sam', orderNumber: 'SLZ-1', amount: 32.98, adminNote: 'Sorry!' }),
    );
  });

  it('does not email when a refund request is rejected', async () => {
    const refund = { id: 'r1', status: 'REQUESTED', order: { orderNumber: 'SLZ-1' } };
    const prisma = { refundRequest: { findUnique: vi.fn().mockResolvedValue(refund), update: vi.fn().mockResolvedValue({ ...refund, status: 'REJECTED' }) } };
    const mail = { sendRefundEmail: vi.fn() };
    const service = new CheckoutService(prisma as unknown as PrismaService, { get: vi.fn(() => null) } as unknown as ConfigService, mail as unknown as MailService);
    await service.processRefund('r1', { action: 'REJECT', adminNote: '' });
    expect(mail.sendRefundEmail).not.toHaveBeenCalled();
  });
});
