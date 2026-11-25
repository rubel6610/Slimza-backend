import { describe, expect, it, vi } from 'vitest';
import { cardBrandName } from './wallet-rules.js';
import { WalletService } from './wallet.service.js';

describe('wallet rules', () => {
  it('names card brands', () => {
    expect(cardBrandName('visa')).toBe('Visa');
    expect(cardBrandName('amex')).toBe('American Express');
    expect(cardBrandName('newbrand')).toBe('Newbrand');
  });
});

describe('WalletService payments', () => {
  it("lists the customer's paid orders with how they were paid", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'o2', orderNumber: 'SLZ-2', createdAt: new Date(), total: 30, paymentMode: 'stripe', paymentLabel: 'Visa •••• 4242', paymentStatus: 'PAID', status: 'PLACED' },
      { id: 'o1', orderNumber: 'SLZ-1', createdAt: new Date(), total: 28.88, paymentMode: 'demo', paymentLabel: '', paymentStatus: 'PAID', status: 'PLACED' },
    ]);
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ email: 'Sam@Example.com' }) }, order: { findMany } };
    const wallet = new WalletService(prisma as never, { get: () => '' } as never);
    const res = await wallet.payments('u1');
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ userId: 'u1' }, { customerEmail: 'sam@example.com' }]);
    expect(res.map((p) => [p.paymentLabel, p.total])).toEqual([
      ['Visa •••• 4242', 30],
      ['Card (test payment)', 28.88],
    ]);
  });
});

describe('WalletService test-mode cards (no Stripe)', () => {
  function setup() {
    const rows: Array<Record<string, any>> = [];
    const walletCard = {
      findMany: vi.fn(async ({ where }) => rows.filter((r) => r.userId === where.userId).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))),
      findFirst: vi.fn(async ({ where }) => rows.find((r) => r.userId === where.userId && (!where.id || r.id === where.id)) ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { id: `00000000-0000-4000-8000-00000000000${rows.length + 1}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }) => {
        rows.filter((r) => r.userId === where.userId).forEach((r) => Object.assign(r, data));
        return { count: 1 };
      }),
      delete: vi.fn(async ({ where }) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)[0]),
    };
    const tx = { walletCard };
    const prisma = { walletCard, $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg as unknown[]))) };
    return { wallet: new WalletService(prisma as never, { get: () => '' } as never), rows };
  }
  const card = { brand: 'Visa' as const, last4: '4242', expMonth: 12, expYear: 2099, makeDefault: false };

  it('saves brand / last 4 / expiry only; the first card is the default', async () => {
    const { wallet, rows } = setup();
    expect(wallet.cardsMode).toBe('test');
    await wallet.addTestCard('u1', card);
    await wallet.addTestCard('u1', card); // same card again: no duplicate
    await wallet.addTestCard('u1', { ...card, brand: 'Mastercard', last4: '5100' });
    expect(rows.map((r) => [r.brand, r.last4, r.isDefault])).toEqual([
      ['Visa', '4242', true],
      ['Mastercard', '5100', false],
    ]);
    expect(Object.keys(rows[0])).not.toContain('number');
    expect((await wallet.listCards('u1'))[0]).toMatchObject({ last4: '4242', isDefault: true });
  });

  it('refuses expired cards; removing the default promotes the next card', async () => {
    const { wallet, rows } = setup();
    await expect(wallet.addTestCard('u1', { ...card, expYear: 2001 })).rejects.toThrow(/expired/);
    await wallet.addTestCard('u1', card);
    await wallet.addTestCard('u1', { ...card, last4: '1111' });
    await wallet.removeCard('u1', rows[0].id);
    expect(rows.map((r) => [r.last4, r.isDefault])).toEqual([['1111', true]]);
  });
});
