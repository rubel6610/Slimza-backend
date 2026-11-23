import { describe, expect, it } from 'vitest';
import { DEFAULT_TESTIMONIALS_CONFIG, parseTestimonialsForSave } from './testimonials-config.js';

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
