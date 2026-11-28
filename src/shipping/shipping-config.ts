/**
 * ============================================================================
 *  SHIPPING — managed from Dashboard → Shipping (docs/SHIPPING.md)
 * ============================================================================
 * Stored as the CMS section `shipping` (GET /cms, PUT /cms/shipping). A copy of the quote logic runs
 * in the storefront (lib/shipping.ts) to show prices; checkout always recalculates here.
 *
 *  - UK: methods (default: Standard UK Delivery, Evri UK, FREE)
 *  - International: zones of countries, priced by the order's packed weight (weight bands)
 *  - Orders heavier than `maxWeightGrams` can't check out ("contact us for a shipping quote")
 *  - Excluded destinations, BFPO and PO Box addresses are refused
 *  - Shipping is never discounted (coupons / points don't reduce it)
 */
import { z } from 'zod';
import { COUNTRIES, EUROPE, findCountry, normalisePlace, UK } from './countries.js';

export const SHIPPING_CMS_KEY = 'shipping';

const money = z.coerce.number().min(0).max(10_000);
const text = (max: number) => z.string().trim().max(max);

export const ukMethodSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: text(80).min(1),
  carrier: text(60),
  eta: text(60),
  fee: money,
  active: z.boolean(),
});

export const weightBandSchema = z.object({
  /** Up to this packed weight (grams), inclusive */
  maxGrams: z.coerce.number().int().min(1).max(100_000),
  price: money,
});

export const zoneSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: text(80).min(1),
  /** Country names (see countries.ts). Empty + restOfWorld = every other supported country. */
  countries: z.array(text(80)).max(250),
  restOfWorld: z.boolean(),
  carrier: text(80),
  eta: text(60),
  bands: z.array(weightBandSchema).min(1).max(20),
  active: z.boolean(),
});

export const shippingConfigSchema = z.object({
  uk: z.object({ methods: z.array(ukMethodSchema).min(1).max(10) }),
  zones: z.array(zoneSchema).max(20),
  /** Heaviest international order that can check out (grams) */
  maxWeightGrams: z.coerce.number().int().min(1).max(100_000),
  overWeightMessage: text(400),
  /** Used for products whose purchase option has no weight */
  defaultItemWeightGrams: z.coerce.number().int().min(0).max(50_000),
  /** Countries / territories we don't deliver to (country names, or regions like "Crimea") */
  excludedDestinations: z.array(text(80)).max(300),
  blockBfpo: z.boolean(),
  blockPoBox: z.boolean(),
  /** Shown on the Shipping Policy page and at checkout for international orders */
  customsTitle: text(120),
  customsNotice: z.array(text(600)).max(20),
  conditions: z.array(text(400)).max(30),
  trackingNotice: text(600),
  carriersNote: z.array(text(400)).max(10),
});

export type ShippingConfig = z.infer<typeof shippingConfigSchema>;
export type ShippingZone = z.infer<typeof zoneSchema>;

const bands = (a: number, b: number, c: number, d: number) => [
  { maxGrams: 250, price: a },
  { maxGrams: 500, price: b },
  { maxGrams: 1000, price: c },
  { maxGrams: 2000, price: d },
];

/** The client's shipping prices & international delivery policy (25 Nov 2026). */
export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  uk: {
    methods: [{ id: 'uk-standard', name: 'Standard UK Delivery', carrier: 'Evri UK', eta: '2–4 working days', fee: 0, active: true }],
  },
  zones: [
    { id: 'europe', name: 'Zone 1 – Europe', countries: EUROPE, restOfWorld: false, carrier: 'Evri International', eta: '5–10 working days', bands: bands(10.95, 13.95, 17.95, 22.95), active: true },
    { id: 'usa-canada', name: 'Zone 2 – USA & Canada', countries: ['United States', 'Canada'], restOfWorld: false, carrier: 'Evri International', eta: '7–14 working days', bands: bands(14.95, 18.95, 24.95, 32.95), active: true },
    { id: 'aus-nz', name: 'Zone 3 – Australia & New Zealand', countries: ['Australia', 'New Zealand'], restOfWorld: false, carrier: 'Evri International', eta: '7–14 working days', bands: bands(14.95, 18.95, 24.95, 32.95), active: true },
    { id: 'rest-of-world', name: 'Zone 4 – Rest of the World', countries: [], restOfWorld: true, carrier: 'Royal Mail International Tracked', eta: '7–21 working days', bands: bands(19.95, 24.95, 32.95, 39.95), active: true },
  ],
  maxWeightGrams: 2000,
  overWeightMessage:
    'International orders over 2kg need a shipping quote. Please contact us at info@slimza.com with your basket and address and we will get back to you.',
  defaultItemWeightGrams: 250,
  excludedDestinations: [
    'Afghanistan', 'Belarus', 'Crimea', 'Cuba', 'Ghana', 'Iran', 'Ivory Coast', 'Kyrgyzstan', 'Niue', 'Nigeria', 'Nevis',
    'North Korea', 'Myanmar', 'Russia', 'São Tomé & Príncipe', 'Somalia', 'South Africa', 'Sudan', 'Syria', 'Tahiti',
    'Western Samoa', 'Venezuela',
  ],
  blockBfpo: true,
  blockPoBox: true,
  customsTitle: 'International customs, duties & taxes',
  customsNotice: [
    'We ship internationally from the United Kingdom.',
    'All international customers are responsible for any customs duties, import taxes, VAT, customs clearance charges or other fees imposed by their destination country.',
    'These charges are not included in our shipping prices unless explicitly stated at checkout.',
    'Customers are responsible for paying any applicable customs charges, import duties and taxes directly to the relevant customs authority or delivery company.',
    'We are not responsible for additional customs charges, import taxes, duties or delays caused by customs authorities in the destination country.',
    'Please note that customs regulations vary from country to country, and international deliveries may be subject to inspection or delays.',
    'By placing an international order, the customer acknowledges and agrees that they are responsible for any applicable import charges and taxes.',
  ],
  conditions: [
    'International shipping prices are calculated according to the destination country and packed order weight.',
    'Delivery times are estimates and are not guaranteed.',
    'Customers are responsible for providing a complete and accurate delivery address.',
    'We reserve the right to refuse delivery to countries that are not supported by our shipping carriers.',
    'International orders may be subject to customs inspection.',
    'Shipping prices may be updated from time to time.',
  ],
  trackingNotice:
    "All international shipping prices are for tracked international delivery. You will receive a tracking number once your order has been dispatched. Tracking updates are provided through the delivery journey, subject to the destination country's postal or courier network.",
  carriersNote: [
    'UK orders are delivered by Evri UK.',
    'International orders are sent with Evri International, or Royal Mail International Tracked.',
    'For heavier or express international orders, Parcelforce Worldwide may be used where appropriate.',
    'We always use a carrier that can deliver to your destination country.',
  ],
};

export function readShippingConfig(raw: unknown): ShippingConfig {
  const parsed = shippingConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SHIPPING_CONFIG;
}

export function parseShippingConfigForSave(raw: unknown): { ok: true; data: ShippingConfig } | { ok: false; message: string } {
  const parsed = shippingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue.message}${issue.path.length ? ` (${issue.path.join('.')})` : ''}` };
  }
  const data = parsed.data;
  if (data.zones.filter((z) => z.restOfWorld).length > 1) return { ok: false, message: 'Only one zone can be "Rest of the World".' };
  for (const zone of data.zones) {
    zone.bands = [...zone.bands].sort((a, b) => a.maxGrams - b.maxGrams);
    const unknown = zone.countries.filter((c) => !findCountry(c));
    if (unknown.length) return { ok: false, message: `Unknown country in ${zone.name}: ${unknown.join(', ')}` };
  }
  const ids = new Set<string>();
  for (const m of data.uk.methods) {
    if (ids.has(m.id)) return { ok: false, message: `Two UK methods share the id "${m.id}"` };
    ids.add(m.id);
  }
  if (!data.uk.methods.some((m) => m.active)) return { ok: false, message: 'Keep at least one UK delivery method active.' };
  return { ok: true, data };
}

// ---- Quotes ------------------------------------------------------------------------------

export interface ShippingAddressLike {
  country?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  district?: string | null;
  postcode?: string | null;
}

export interface ShippingMethodQuote {
  id: string;
  name: string;
  carrier: string;
  eta: string;
  fee: number;
  international: boolean;
}

export type ShippingQuote =
  | { ok: true; methods: ShippingMethodQuote[]; international: boolean; zone: ShippingZone | null; weightGrams: number }
  | { ok: false; reason: 'excluded' | 'overweight' | 'bfpo' | 'pobox' | 'unsupported'; message: string; weightGrams: number };

const isUk = (country?: string | null) => findCountry(country ?? '')?.name === UK || !country?.trim();

/** Is this address in an excluded destination? (country, alias, or a region named in the address — e.g. Crimea) */
export function excludedDestination(config: ShippingConfig, address: ShippingAddressLike): string | null {
  const country = findCountry(address.country ?? '');
  const countryNames = country ? [country.name, ...(country.aliases ?? [])].map(normalisePlace) : [normalisePlace(address.country ?? '')];
  const addressText = ` ${normalisePlace([address.line1, address.line2, address.city, address.district, address.postcode].filter(Boolean).join(' '))} `;
  for (const entry of config.excludedDestinations) {
    const n = normalisePlace(entry);
    if (!n) continue;
    if (countryNames.includes(n)) return entry;
    // Regions that aren't countries in our list (Crimea, Nevis, Tahiti) are matched in the address.
    const isCountryName = Boolean(findCountry(entry));
    if (!isCountryName && addressText.includes(` ${n} `)) return entry;
  }
  return null;
}

const BFPO = /\bb\.?\s*f\.?\s*p\.?\s*o\b/i;
const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s*office\s*box|pobox)\b/i;

/** Zone for a (non-UK) country, or null when no active zone covers it. */
export function zoneFor(config: ShippingConfig, countryName: string): ShippingZone | null {
  const country = findCountry(countryName);
  if (!country) return null;
  const n = normalisePlace(country.name);
  const active = config.zones.filter((z) => z.active);
  return active.find((z) => !z.restOfWorld && z.countries.some((c) => normalisePlace(findCountry(c)?.name ?? c) === n)) ?? active.find((z) => z.restOfWorld) ?? null;
}

/** Price of a zone for a packed weight (null = heavier than its last band). */
export function bandPrice(zone: ShippingZone, weightGrams: number): number | null {
  const band = [...zone.bands].sort((a, b) => a.maxGrams - b.maxGrams).find((b) => weightGrams <= b.maxGrams);
  return band ? band.price : null;
}

/**
 * Delivery options for an address and a packed weight. UK → the active UK methods; anywhere else →
 * one tracked method priced by zone and weight. `ignoreRestrictions` is only for recording an order
 * the customer has already paid for.
 */
export function quoteShipping(
  config: ShippingConfig,
  address: ShippingAddressLike,
  weightGrams: number,
  options: { ignoreRestrictions?: boolean } = {},
): ShippingQuote {
  const strict = !options.ignoreRestrictions;
  const lines = [address.line1, address.line2, address.postcode].filter(Boolean).join(' ');
  if (strict && config.blockBfpo && BFPO.test(lines)) {
    return { ok: false, reason: 'bfpo', message: "Sorry, we can't deliver to BFPO addresses.", weightGrams };
  }
  if (strict && config.blockPoBox && PO_BOX.test(lines)) {
    return { ok: false, reason: 'pobox', message: "Sorry, we can't deliver to PO Box addresses. Please use a street address.", weightGrams };
  }

  if (isUk(address.country)) {
    const methods = config.uk.methods
      .filter((m) => m.active)
      .map((m) => ({ id: m.id, name: m.name, carrier: m.carrier, eta: m.eta, fee: m.fee, international: false }));
    return { ok: true, methods, international: false, zone: null, weightGrams };
  }

  const excluded = excludedDestination(config, address);
  if (strict && excluded) {
    return { ok: false, reason: 'excluded', message: `Sorry, we don't currently deliver to ${excluded}.`, weightGrams };
  }
  const zone = zoneFor(config, address.country ?? '');
  if (!zone) {
    return { ok: false, reason: 'unsupported', message: `Sorry, we don't currently deliver to ${address.country}.`, weightGrams };
  }
  const limit = Math.min(config.maxWeightGrams, Math.max(...zone.bands.map((b) => b.maxGrams)));
  const price = bandPrice(zone, weightGrams);
  if (weightGrams > limit || price === null) {
    if (strict) return { ok: false, reason: 'overweight', message: config.overWeightMessage, weightGrams };
  }
  const fee = price ?? Math.max(...zone.bands.map((b) => b.price));
  return {
    ok: true,
    methods: [{ id: `intl-${zone.id}`, name: `Tracked International Delivery (${zone.name.replace(/^Zone \d+\s*[–-]\s*/, '')})`, carrier: zone.carrier, eta: zone.eta, fee, international: true }],
    international: true,
    zone,
    weightGrams,
  };
}

/** The chosen method from a quote (the first one when the id isn't offered). */
export function pickMethod(quote: Extract<ShippingQuote, { ok: true }>, methodId?: string | null): ShippingMethodQuote | null {
  return quote.methods.find((m) => m.id === methodId) ?? quote.methods[0] ?? null;
}

/** Countries a customer may choose (excluded ones left out), UK first. */
export function selectableCountries(config: ShippingConfig): string[] {
  return COUNTRIES.filter((c) => !excludedDestination(config, { country: c.name })).map((c) => c.name);
}
