import { describe, expect, it } from 'vitest';
import { parseTestimonialsForSave } from './testimonials-config.js';

// Test data only (the real reviews come from Dashboard → CMS → Customer Reviews).
const DEFAULT_TESTIMONIALS_CONFIG = {
  enabled: true,
  title: 'What Our Customers Say',
  items: [{ id: 't-1', name: 'Test Customer', quote: 'Great products.', rating: 5, imageUrl: '', location: '', active: true, archivedAt: null }],
};

describe('testimonials config', () => {
  it('accepts the defaults', () => {
    expect(parseTestimonialsForSave(DEFAULT_TESTIMONIALS_CONFIG).ok).toBe(true);
  });

  it('rejects empty quotes, bad ratings and duplicate ids', () => {
    const item = DEFAULT_TESTIMONIALS_CONFIG.items[0];
    const withItems = (items: unknown[]) => parseTestimonialsForSave({ ...DEFAULT_TESTIMONIALS_CONFIG, items });
    expect(withItems([{ ...item, quote: '  ' }]).ok).toBe(false);
    expect(withItems([{ ...item, rating: 6 }]).ok).toBe(false);
    expect(withItems([item, item])).toMatchObject({ ok: false, message: expect.stringContaining('Duplicate') });
  });
});
