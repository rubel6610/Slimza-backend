export interface BackendProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  sizeType: 'powder' | 'resin' | 'pack';
}

export const SIZE_TABLES: Record<
  'powder' | 'resin' | 'pack',
  { label: string; multiplier: number }[]
> = {
  powder: [
    { label: '50 g', multiplier: 1 },
    { label: '100 g', multiplier: 1.8 },
    { label: '250 g', multiplier: 4 },
    { label: '500 g', multiplier: 7.5 },
  ],
  resin: [
    { label: '15 g', multiplier: 1 },
    { label: '30 g', multiplier: 1.8 },
    { label: '50 g', multiplier: 2.8 },
  ],
  pack: [
    { label: '14 sticks', multiplier: 1 },
    { label: '30 sticks', multiplier: 1.9 },
  ],
};

export const SUPPLY_PLAN_DISCOUNTS: Record<number, { discount: number; label: string }> = {
  1: { discount: 0, label: '1 Month Supply' },
  2: { discount: 0.1, label: '2 Month Supply' },
  3: { discount: 0.15, label: '3 Month Supply' },
};

export const BACKEND_CATALOG: Record<string, BackendProduct> = {
  p01: {
    id: 'p01',
    name: 'Slimza Detox Elixir “Buy One, Get One Free”',
    price: 27.99,
    image: '/products/tea/teatox-green.png',
    sizeType: 'powder',
  },
  p02: {
    id: 'p02',
    name: 'Himalayan Shilajit Resin',
    price: 39.99,
    image: '/products/shilajit/shilajit-resin.png',
    sizeType: 'resin',
  },
  p03: {
    id: 'p03',
    name: 'Slimza Active Body Teatox Duo – Feel Great Naturally',
    price: 22.5,
    image: '/products/tea/teatox-double.jpg',
    sizeType: 'powder',
  },
  p04: {
    id: 'p04',
    name: 'Slimza Active Body Teatox – Where Feeling Good Begins',
    price: 34.99,
    image: '/products/tea/teatox-single.jpg',
    sizeType: 'powder',
  },
  p05: {
    id: 'p05',
    name: 'Active Body Shilajit Coffee',
    price: 29.99,
    image: '/products/shilajit/shilajit-coffee.png',
    sizeType: 'powder',
  },
  p06: {
    id: 'p06',
    name: 'Active Body Electrolytes – Orange',
    price: 18.99,
    image: '/products/hydration/electrolytes-orange.png',
    sizeType: 'pack',
  },
  p07: {
    id: 'p07',
    name: 'Slim Fit Metabolism Tea',
    price: 21.99,
    image: '/shop-categories/teatox.jpg',
    sizeType: 'powder',
  },
  p08: {
    id: 'p08',
    name: 'Immunity Wellness Capsules',
    price: 26.99,
    image: '/shop-categories/Wellness Supplements.png',
    sizeType: 'pack',
  },
  p09: {
    id: 'p09',
    name: 'Botanical Herbal Tea',
    price: 16.99,
    image: '/featured-products/herbal-wellness-tea.jpg',
    sizeType: 'powder',
  },
  p10: {
    id: 'p10',
    name: 'Digestive Detox Tea',
    price: 19.99,
    image: '/products/tea/teatox-double.jpg',
    sizeType: 'powder',
  },
  p11: {
    id: 'p11',
    name: 'Sleep & Relax Collagen Blend',
    price: 31.99,
    image: '/products/tea/teatox-single.jpg',
    sizeType: 'powder',
  },
  p12: {
    id: 'p12',
    name: 'Chamomile Night Tea',
    price: 14.99,
    image: '/shop-categories/teatox.jpg',
    sizeType: 'powder',
  },
  p13: {
    id: 'p13',
    name: 'Shilajit Energy Gummies',
    price: 28.99,
    image: '/shop-categories/Pure Shilajit Resin.png',
    sizeType: 'pack',
  },
  p14: {
    id: 'p14',
    name: 'Slimza Radiance Beauty Tea',
    price: 18.5,
    image: '/products/tea/teatox-white.png',
    sizeType: 'powder',
  },
  p15: {
    id: 'p15',
    name: 'Super Greens Daily Blend',
    price: 24.99,
    image: '/products/tea/teatox-double.jpg',
    sizeType: 'powder',
  },
  p16: {
    id: 'p16',
    name: 'Slimza Ultimate Tea Duo – Detox Elixir & Slimza Radiance Tea “Buy One, Get One Free”',
    price: 27.99,
    image: '/products/tea/teatox-double.jpg',
    sizeType: 'powder',
  },
};

export const BACKEND_BUNDLE_PRODUCTS: Record<
  string,
  { name: string; price: number; image: string }
> = {
  tea: { name: 'Tea', price: 10, image: '/shop-categories/Herbal Wellness Tea.png' },
  matcha: { name: 'Matcha', price: 15, image: '/shop-categories/Ceremonial Matcha.png' },
  shilajit: { name: 'Shilajit Resin', price: 40, image: '/shop-categories/Pure Shilajit Resin.png' },
  collagen: { name: 'Collagen', price: 30, image: '/shop-categories/sleep.png' },
  'coffee-shilajit': { name: 'Shilajit Coffee', price: 25, image: '/shop-categories/Functional Coffee.png' },
};

export const SHIPPING_METHODS: Record<
  string,
  { id: string; name: string; fee: number; eta: string }
> = {
  'uk-standard': {
    id: 'uk-standard',
    name: 'Standard UK Delivery',
    fee: 0,
    eta: '2–4 working days',
  },
  'uk-express': {
    id: 'uk-express',
    name: 'Express Next-Day Delivery',
    fee: 4.99,
    eta: 'Next working day',
  },
  'uk-saturday': {
    id: 'uk-saturday',
    name: 'Saturday Guaranteed Delivery',
    fee: 7.99,
    eta: 'Next Saturday',
  },
};

export const PROMO_CODES: Record<string, number> = {
  SLIMZAX2: 0.1,
};

export const BUNDLE_SPEND_REWARD = {
  threshold: 500,
  amount: 5,
};

export const round2 = (num: number): number =>
  Math.round((num + Number.EPSILON) * 100) / 100;
