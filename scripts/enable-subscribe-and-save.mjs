/**
 * One-off fix for products added before Subscribe & Save existed:
 *  - switches Subscribe & Save on for every product that has purchase options (packages)
 *  - gives each package with a 0% subscription discount the default discount below
 * Packages and their one-time prices are not changed. Products already set up are left alone
 * (a package that already has a discount keeps it). Safe to run more than once.
 *
 *   node scripts/enable-subscribe-and-save.mjs            # preview only
 *   node scripts/enable-subscribe-and-save.mjs --apply    # write the changes
 *   node scripts/enable-subscribe-and-save.mjs --apply --discount=15
 *
 * Reads DATABASE_URL from .env. Afterwards restart the backend (or clear the Redis "products:" cache)
 * so the shop shows the change straight away.
 */
import 'dotenv/config';
import mariadb from 'mariadb';

const apply = process.argv.includes('--apply');
const discountArg = process.argv.find((a) => a.startsWith('--discount='));
const DEFAULT_DISCOUNT = discountArg ? Number(discountArg.split('=')[1]) : 10;
if (!(DEFAULT_DISCOUNT >= 0 && DEFAULT_DISCOUNT <= 90)) throw new Error('--discount must be 0–90');

const url = new URL(process.env.DATABASE_URL);
const conn = await mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  allowPublicKeyRetrieval: true,
});

try {
  const rows = await conn.query('SELECT id, name, subscriptionEnabled, supplyOptions FROM Product');
  let changed = 0;
  for (const row of rows) {
    const raw = typeof row.supplyOptions === 'string' ? JSON.parse(row.supplyOptions) : row.supplyOptions;
    const options = Array.isArray(raw) ? raw : [];
    if (options.length === 0) {
      console.log(`skip   ${row.name} — no packages (add them in Dashboard → Products)`);
      continue;
    }
    const nextOptions = options.map((o) =>
      Number(o.subscribeDiscountPercent) > 0 ? o : { ...o, subscribeDiscountPercent: DEFAULT_DISCOUNT },
    );
    const optionsChanged = JSON.stringify(nextOptions) !== JSON.stringify(options);
    const enable = !row.subscriptionEnabled;
    if (!optionsChanged && !enable) {
      console.log(`ok     ${row.name}`);
      continue;
    }
    changed++;
    console.log(
      `${apply ? 'update' : 'would '} ${row.name}: ${enable ? 'Subscribe & Save on' : ''}${enable && optionsChanged ? ', ' : ''}${
        optionsChanged ? `packages ${nextOptions.map((o) => `${o.label} ${o.subscribeDiscountPercent}%`).join(' / ')}` : ''
      }`,
    );
    if (apply) {
      await conn.query('UPDATE Product SET subscriptionEnabled = 1, supplyOptions = ?, updatedAt = NOW(3) WHERE id = ?', [
        JSON.stringify(nextOptions),
        row.id,
      ]);
    }
  }
  console.log(`\n${changed} product(s) ${apply ? 'updated' : 'to update — run again with --apply'}.`);
} finally {
  await conn.end();
}
