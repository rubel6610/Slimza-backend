/**
 * Homepage "What Our Customers Say" — CMS section `testimonials`
 * (GET /cms, PUT /cms/testimonials; managed in Dashboard → CMS → Testimonials).
 * Items use the normal CMS archive lifecycle (path `items`, see cms-archive.ts).
 */
import { z } from 'zod';

export const TESTIMONIALS_CMS_KEY = 'testimonials';

const text = (max: number) => z.string().trim().max(max);

export const testimonialSchema = z.object({
  id: z.string().trim().min(1).max(60),
  name: text(60).min(1, 'Every review needs a customer name'),
  quote: text(400).min(1, 'Every review needs a quote'),
  rating: z.number().int().min(1).max(5),
  /** Uploaded photo URL ("" = initials avatar) */
  imageUrl: text(1000),
  /** Optional, e.g. "Manchester" or "Verified buyer" */
  location: text(60),
  active: z.boolean(),
  archivedAt: z.string().nullable().optional(),
});

export const testimonialsConfigSchema = z.object({
  enabled: z.boolean(),
  title: text(80).min(1, 'Give the section a title'),
  items: z.array(testimonialSchema).max(50),
});

export type TestimonialsConfig = z.infer<typeof testimonialsConfigSchema>;

export function parseTestimonialsForSave(
  raw: unknown,
): { ok: true; data: TestimonialsConfig } | { ok: false; message: string } {
  const parsed = testimonialsConfigSchema.safeParse(raw);
  if (parsed.success) {
    const ids = new Set<string>();
    for (const item of parsed.data.items) {
      if (ids.has(item.id)) return { ok: false, message: `Duplicate review id "${item.id}"` };
      ids.add(item.id);
    }
    return { ok: true, data: parsed.data };
  }
  const issue = parsed.error.issues[0];
  return { ok: false, message: `${issue.message}${issue.path.length ? ` (${issue.path.join('.')})` : ''}` };
}
