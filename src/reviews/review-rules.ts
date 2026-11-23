/** Pure helpers for reviews (no database), so they are easy to test. */

/** "Sarah Mitchell" → "Sarah M." (falls back to "Slimza customer"). */
export function publicName(user: { firstName?: string | null; lastName?: string | null; name?: string | null }): string {
  const first = user.firstName?.trim() || user.name?.trim().split(/\s+/)[0] || '';
  const last = user.lastName?.trim() || user.name?.trim().split(/\s+/).slice(1).join(' ') || '';
  if (!first) return 'Slimza customer';
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

export interface RatingSummary {
  average: number;
  count: number;
  /** stars → number of reviews, for 5..1 */
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** From `groupBy(rating)` rows. Average is rounded to 1 decimal. */
export function summarise(rows: Array<{ rating: number; count: number }>): RatingSummary {
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as RatingSummary['breakdown'];
  let count = 0;
  let total = 0;
  for (const { rating, count: n } of rows) {
    if (rating < 1 || rating > 5) continue;
    breakdown[rating as 1 | 2 | 3 | 4 | 5] += n;
    count += n;
    total += rating * n;
  }
  return { average: count ? Math.round((total / count) * 10) / 10 : 0, count, breakdown };
}
