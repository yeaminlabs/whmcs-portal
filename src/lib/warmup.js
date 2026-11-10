'use strict';

/**
 * Fills the global caches right after the server starts, so the first visitors
 * do not pay for GetProducts, store visibility, TLD pricing and friends.
 * Never throws; failures are logged and the caches fill on first use instead.
 */
const currency = require('./currency');
const catalog = require('./catalog');

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(`[warmup] ${name} failed: ${e.message}`);
  }
}

async function warmup() {
  const started = Date.now();
  try {
    await Promise.all([
      step('currencies + TLD pricing', async () => {
        const list = await currency.listCurrencies();
        await Promise.all(list.map((c) => catalog.getTldPrices(c.id)));
      }),
      step('products', () => catalog.loadProducts()),
      step('store visibility', () => Promise.all(catalog.GROUPS.map((g) => catalog.visibleSlugs(g.slug)))),
      step('payment methods', () => catalog.paymentMethods()),
    ]);
    console.log(`[warmup] caches ready in ${Date.now() - started}ms`);
  } catch (e) {
    console.warn(`[warmup] failed: ${e.message}`);
  }
}

module.exports = { warmup };
