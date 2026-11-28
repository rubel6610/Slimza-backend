import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIPPING_CONFIG as config,
  parseShippingConfigForSave,
  quoteShipping,
  selectableCountries,
  type ShippingConfig,
} from './shipping-config.js';

const fee = (country: string, grams: number) => {
  const q = quoteShipping(config, { country, line1: '1 High Street' }, grams);
  if (!q.ok) throw new Error(q.message);
  return q.methods[0].fee;
};

describe('shipping — client price list (25 Nov)', () => {
  it('UK standard delivery is free with Evri UK', () => {
    const q = quoteShipping(config, { country: 'United Kingdom', line1: '1 High Street' }, 1800);
    expect(q.ok && q.methods[0]).toMatchObject({ fee: 0, carrier: 'Evri UK', international: false });
    expect(fee('England', 250)).toBe(0);
  });

  it.each([
    ['France', [10.95, 13.95, 17.95, 22.95]],
    ['Ireland', [10.95, 13.95, 17.95, 22.95]],
    ['United States', [14.95, 18.95, 24.95, 32.95]],
    ['Canada', [14.95, 18.95, 24.95, 32.95]],
    ['Australia', [14.95, 18.95, 24.95, 32.95]],
    ['New Zealand', [14.95, 18.95, 24.95, 32.95]],
    ['Japan', [19.95, 24.95, 32.95, 39.95]],
  ])('%s is priced by weight band', (country, prices) => {
    expect([250, 500, 1000, 2000].map((g) => fee(country, g))).toEqual(prices);
    expect(fee(country, 251)).toBe(prices[1]);
  });

  it('over 2kg asks the customer to contact us for a quote', () => {
    const q = quoteShipping(config, { country: 'France', line1: '1 Rue X' }, 2001);
    expect(q).toMatchObject({ ok: false, reason: 'overweight' });
  });

  it('international is tracked with the zone carrier', () => {
    const q = quoteShipping(config, { country: 'Germany', line1: 'Hauptstr. 1' }, 300);
    expect(q.ok && q.methods[0]).toMatchObject({ id: 'intl-europe', carrier: 'Evri International', international: true });
  });
});

describe('shipping — blocked destinations and addresses', () => {
  it.each(['Russia', 'Nigeria', 'Ivory Coast', "Côte d'Ivoire", 'Western Samoa', 'North Korea', 'South Africa'])('%s cannot check out', (country) => {
    expect(quoteShipping(config, { country, line1: '1 Main Road' }, 250)).toMatchObject({ ok: false, reason: 'excluded' });
  });

  it('regions in the excluded list (Crimea, Tahiti, Nevis) are matched in the address', () => {
    expect(quoteShipping(config, { country: 'Ukraine', line1: '5 Lenina', city: 'Simferopol', district: 'Crimea' }, 250)).toMatchObject({ reason: 'excluded' });
    expect(quoteShipping(config, { country: 'French Polynesia', line1: '1 Rue', city: 'Papeete', district: 'Tahiti' }, 250)).toMatchObject({ reason: 'excluded' });
    expect(quoteShipping(config, { country: 'Saint Kitts and Nevis', line1: '1 Main St', district: 'Nevis' }, 250)).toMatchObject({ reason: 'excluded' });
    expect(quoteShipping(config, { country: 'Ukraine', line1: '5 Khreshchatyk', city: 'Kyiv' }, 250).ok).toBe(true);
  });

  it('blocks BFPO and PO Box addresses', () => {
    expect(quoteShipping(config, { country: 'United Kingdom', line1: 'BFPO 123' }, 250)).toMatchObject({ reason: 'bfpo' });
    expect(quoteShipping(config, { country: 'United States', line1: 'P.O. Box 77' }, 250)).toMatchObject({ reason: 'pobox' });
    expect(quoteShipping(config, { country: 'United States', line1: 'PO Box 77' }, 250)).toMatchObject({ reason: 'pobox' });
    expect(quoteShipping(config, { country: 'United States', line1: '12 Box Hill Road' }, 250).ok).toBe(true);
  });

  it('a paid order is still recorded when the rules change later', () => {
    expect(quoteShipping(config, { country: 'Russia', line1: 'x' }, 5000, { ignoreRestrictions: true }).ok).toBe(true);
  });

  it('the country list leaves out excluded countries', () => {
    const list = selectableCountries(config);
    expect(list).toContain('United Kingdom');
    expect(list).toContain('France');
    expect(list).not.toContain('Russia');
    expect(list).not.toContain('Samoa');
  });
});

describe('shipping — dashboard settings', () => {
  const copy = (): ShippingConfig => structuredClone(config);

  it('edited prices are used', () => {
    const edited = copy();
    edited.zones[0].bands[0].price = 9.5;
    const q = quoteShipping(edited, { country: 'Spain', line1: 'Calle 1' }, 200);
    expect(q.ok && q.methods[0].fee).toBe(9.5);
  });

  it('a switched-off zone falls back to Rest of World', () => {
    const edited = copy();
    edited.zones.find((z) => z.id === 'usa-canada')!.active = false;
    const q = quoteShipping(edited, { country: 'Canada', line1: '1 Main' }, 250);
    expect(q.ok && q.methods[0].fee).toBe(19.95);
  });

  it('removing a country from the excluded list allows it', () => {
    const edited = copy();
    edited.excludedDestinations = edited.excludedDestinations.filter((d) => d !== 'Ghana');
    expect(quoteShipping(edited, { country: 'Ghana', line1: '1 Main' }, 250).ok).toBe(true);
  });

  it('rejects unknown countries, two Rest of World zones and no active UK method', () => {
    const a = copy();
    a.zones[0].countries.push('Atlantis');
    expect(parseShippingConfigForSave(a)).toMatchObject({ ok: false });
    const b = copy();
    b.zones[0].restOfWorld = true;
    expect(parseShippingConfigForSave(b)).toMatchObject({ ok: false });
    const c = copy();
    c.uk.methods.forEach((m) => (m.active = false));
    expect(parseShippingConfigForSave(c)).toMatchObject({ ok: false });
    expect(parseShippingConfigForSave(copy())).toMatchObject({ ok: true });
  });
});
