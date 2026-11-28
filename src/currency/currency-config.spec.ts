import { describe, expect, it } from 'vitest';
import { DEFAULT_CURRENCY_CONFIG, parseCurrencyConfigForSave } from './currency-config.js';

const withCurrencies = (fn: (c: typeof DEFAULT_CURRENCY_CONFIG) => unknown) =>
  fn(structuredClone(DEFAULT_CURRENCY_CONFIG));

describe('currency config', () => {
  it('accepts the defaults (GBP, USD, EUR, AED, SAR)', () => {
    const res = parseCurrencyConfigForSave(DEFAULT_CURRENCY_CONFIG);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.currencies.map((c) => c.code)).toEqual(['GBP', 'USD', 'EUR', 'AED', 'SAR']);
  });

  it('upper-cases codes', () => {
    const res = parseCurrencyConfigForSave(withCurrencies((c) => ({ ...c, defaultCurrency: 'usd', currencies: c.currencies.map((x) => ({ ...x, code: x.code.toLowerCase() })) })));
    expect(res.ok && res.data.defaultCurrency).toBe('USD');
  });

  it('keeps GBP at rate 1 and active', () => {
    const changeGbp = (patch: object) =>
      parseCurrencyConfigForSave(withCurrencies((c) => ({ ...c, currencies: c.currencies.map((x) => (x.code === 'GBP' ? { ...x, ...patch } : x)) })));
    expect(changeGbp({ rate: 1.1 })).toMatchObject({ ok: false, message: expect.stringContaining('GBP rate must be 1') });
    expect(changeGbp({ active: false })).toMatchObject({ ok: false, message: expect.stringContaining('GBP must stay active') });
    expect(parseCurrencyConfigForSave(withCurrencies((c) => ({ ...c, currencies: c.currencies.filter((x) => x.code !== 'GBP') }))).ok).toBe(false);
  });

  it('rejects zero rates, duplicates and an inactive default', () => {
    expect(parseCurrencyConfigForSave(withCurrencies((c) => ({ ...c, currencies: c.currencies.map((x) => (x.code === 'USD' ? { ...x, rate: 0 } : x)) }))).ok).toBe(false);
    expect(parseCurrencyConfigForSave(withCurrencies((c) => ({ ...c, currencies: [...c.currencies, c.currencies[1]] }))).ok).toBe(false);
    expect(
      parseCurrencyConfigForSave(withCurrencies((c) => ({ ...c, defaultCurrency: 'EUR', currencies: c.currencies.map((x) => (x.code === 'EUR' ? { ...x, active: false } : x)) }))).ok,
    ).toBe(false);
  });
});
