import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFranchiseApplicationSchema } from './franchise.schemas.js';
import { FranchiseService } from './franchise.service.js';

const valid = {
  fullName: 'Ada Lovelace',
  email: 'ADA@Example.com',
  phone: '+44 7700 900123',
  address: '1 High Street, Leeds',
  businessName: 'Ada Wellness Ltd',
  country: 'United Kingdom',
  location: 'Leeds',
  interest: 'FRANCHISE',
  channel: 'RETAIL',
};

describe('franchise application schema', () => {
  it('accepts a complete form and normalises the email', () => {
    const parsed = createFranchiseApplicationSchema.parse(valid);
    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.message).toBe('');
  });

  it('ignores a "website" value (browsers autofill it; it is not the spam trap)', () => {
    const parsed = createFranchiseApplicationSchema.parse({ ...valid, website: 'https://ada.example' });
    expect(parsed._gotcha).toBe('');
  });

  it('rejects missing required fields', () => {
    const result = createFranchiseApplicationSchema.safeParse({ ...valid, phone: 'abc', country: '' });
    expect(result.success).toBe(false);
  });
});

describe('FranchiseService', () => {
  let prisma: any;
  let mail: { sendFranchiseApplicationEmails: ReturnType<typeof vi.fn> };
  let service: FranchiseService;

  beforeEach(() => {
    prisma = {
      franchiseApplication: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'f1', ...data })),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    mail = { sendFranchiseApplicationEmails: vi.fn().mockResolvedValue(undefined) };
    service = new FranchiseService(prisma, mail as never);
  });

  it('stores the application and sends emails', async () => {
    const res = await service.create(createFranchiseApplicationSchema.parse(valid));
    expect(res).toEqual({ ok: true, id: 'f1' });
    expect(prisma.franchiseApplication.create).toHaveBeenCalled();
    expect(mail.sendFranchiseApplicationEmails).toHaveBeenCalled();
  });

  it('silently drops honeypot submissions', async () => {
    const res = await service.create(createFranchiseApplicationSchema.parse({ ...valid, _gotcha: 'spam.biz' }));
    expect(res).toEqual({ ok: true });
    expect(prisma.franchiseApplication.create).not.toHaveBeenCalled();
  });

  it('only deletes archived applications', async () => {
    prisma.franchiseApplication.findUnique.mockResolvedValue({ id: 'f1', fullName: 'Ada', archivedAt: null });
    await expect(service.remove('f1')).rejects.toThrow(ConflictException);
    prisma.franchiseApplication.findUnique.mockResolvedValue({ id: 'f1', fullName: 'Ada', archivedAt: new Date() });
    await expect(service.remove('f1')).resolves.toEqual({ ok: true });
  });
});
