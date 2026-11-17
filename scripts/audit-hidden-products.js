'use strict';

/**
 * Lists the WHMCS products the portal hides (hidden or retired in WHMCS), per group.
 *   node scripts/audit-hidden-products.js          # readable report
 *   node scripts/audit-hidden-products.js --json   # machine readable
 * Read-only: one GetProducts call plus one public store page per group.
 */
const catalog = require('../src/lib/catalog');

(async () => {
  const all = await catalog.loadProducts();
  const byGroup = new Map();
  for (const p of all) {
    const path = catalog.storePath(p.product_url);
    const group = path ? path.group : '(no store url)';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({ pid: Number(p.pid), name: p.name, slug: path ? path.product : p.slug });
  }
  const report = [];
  for (const [group, products] of byGroup) {
    let visible = null;
    try { visible = await catalog.fetchVisibleSlugs(group, await catalog.storeBase(group)); } catch (e) { report.push({ group, error: e.message }); continue; }
    report.push({ group, total: products.length, visible: products.filter((p) => visible.has(p.slug)).length, hidden: products.filter((p) => !visible.has(p.slug)) });
  }
  if (process.argv.includes('--json')) return console.log(JSON.stringify(report, null, 2));
  for (const r of report) {
    if (r.error) { console.log(`${r.group}: could not check (${r.error})`); continue; }
    console.log(`${r.group}: ${r.visible}/${r.total} shown${r.hidden.length ? `, hidden: ${r.hidden.map((p) => `${p.name} (#${p.pid})`).join(', ')}` : ''}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
