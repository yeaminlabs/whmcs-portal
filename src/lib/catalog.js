'use strict';

/**
 * Store catalog built from WHMCS GetProducts.
 *
 * GetProducts returns hidden and retired products too, and has no flag for
 * either, so visibility is synced from the public store group page
 * (/store/<group>) — the same list customers see on portal.snbdhost.com.
 * Whatever is hidden or retired in WHMCS is therefore dropped from the portal
 * store, the order flow and the plan-upgrade list.
 *
 * Visibility is fail-closed once it has been seen: the last good answer per
 * group is kept on disk, so an outage or restart never re-exposes products.
 * Only a group that has never been synced falls back to showing everything.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const whmcs = require('./whmcs');
const config = require('../config');
const { cached } = require('./cache');

const GROUPS = [
  { slug: 'usa-shared-hosting', name: 'USA Shared Hosting', family: 'hosting', blurb: 'NVMe hosting on US servers for global reach.' },
  { slug: 'bdix-shared-hosting', name: 'BDIX Shared Hosting', family: 'hosting', blurb: 'Lightning-fast local hosting for visitors in Bangladesh.' },
  { slug: 'usa-reseller-hosting', name: 'USA Reseller Hosting', family: 'reseller', blurb: 'White-label USA hosting for agencies and growing hosting brands.' },
  { slug: 'bdix-reseller-hosting', name: 'BDIX Reseller Hosting', family: 'reseller', blurb: 'Launch local hosting plans with fast BDIX connectivity and WHM.' },
  { slug: 'n8n', name: 'n8n Hosting', family: 'automation', blurb: 'Managed n8n instances, deployed instantly. No self-hosting.' },
  { slug: 'openclaw-hosting', name: 'OpenClaw Hosting', family: 'ai', blurb: 'Your own OpenClaw AI agent instance, deployed instantly on dedicated, isolated resources.' },
  { slug: 'bdix-vps', name: 'BDIX VPS', family: 'vps', blurb: 'Ultra-low-latency servers in Bangladesh with full root access.' },
  { slug: 'usa-vps', name: 'USA VPS', family: 'vps', blurb: 'AMD EPYC power on a premium North American uplink.' },
  { slug: 'sg-vps', name: 'Singapore VPS', family: 'vps', blurb: 'Low-latency routing across South-East Asia.' },
  { slug: 'eu-vps', name: 'EU VPS', family: 'vps', blurb: 'Germany and Finland nodes on AMD EPYC.' },
];

const FAMILIES = [
  { id: 'hosting', label: 'Shared hosting' },
  { id: 'reseller', label: 'Reseller hosting' },
  { id: 'vps', label: 'VPS servers' },
  { id: 'automation', label: 'n8n automation' },
  { id: 'ai', label: 'AI agent hosting' },
];

const CYCLES = [
  ['monthly', 'Monthly', 1, 'msetupfee'],
  ['quarterly', 'Quarterly', 3, 'qsetupfee'],
  ['semiannually', 'Semi-annually', 6, 'ssetupfee'],
  ['annually', 'Annually', 12, 'asetupfee'],
  ['biennially', 'Biennially', 24, 'bsetupfee'],
  ['triennially', 'Triennially', 36, 'tsetupfee'],
];

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const PRODUCTS_TTL = 5 * MIN;
const VISIBILITY_TTL = 10 * MIN;
const VISIBILITY_RETRY = MIN;
const TLD_TTL = 30 * MIN;
const PAYMENT_METHODS_TTL = 10 * MIN;
const ipv4 = new https.Agent({ family: 4 });

const visibilityFailedAt = new Map();

const arr = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

const ENTITIES = { '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&rsquo;': '’', '&trade;': '™' };
function text(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z0-9#]+;/gi, (e) => (e in ENTITIES ? ENTITIES[e] : e))
    .replace(/[`\s]+/g, ' ')
    .trim();
}

function parseDescription(html) {
  let tagline = '';
  const src = String(html || '').replace(/<em>([\s\S]*?)<\/em>/i, (_, t) => { tagline = text(t); return ''; });
  let lead = '';
  const features = [];
  for (const raw of src.split(/<br\s*\/?>|<\/p>|<\/li>|\r?\n/i)) {
    const m = raw.match(/^\s*<strong>([\s\S]*?)<\/strong>([\s\S]*)$/i);
    const main = text(m ? m[1] : raw);
    const note = m ? text(m[2]) : '';
    if (!main) continue;
    if (!lead && !features.length && /^instant deploy/i.test(main) && !note) { lead = main; continue; }
    features.push({ main, note });
  }
  return { lead, tagline, features };
}

function storePath(url) {
  const m = String(url || '').match(/\/store\/([^/?#]+)\/([^/?#]+)/);
  return m ? { group: decodeURIComponent(m[1]), product: decodeURIComponent(m[2]) } : null;
}

function kindOf(type) {
  if (type === 'hostingaccount' || type === 'reselleraccount') return 'hosting';
  if (type === 'server') return 'server';
  return 'other';
}

function pricingFor(p, currencyCode) {
  const table = (p.pricing && (p.pricing[currencyCode] || Object.values(p.pricing)[0])) || null;
  if (!table) return { prefix: '', code: currencyCode, cycles: [] };
  const cycles = [];
  if (p.paytype === 'free') {
    cycles.push({ id: 'free', label: 'Free', months: 0, price: 0, setup: 0 });
  } else if (p.paytype === 'onetime') {
    cycles.push({ id: 'onetime', label: 'One time', months: 0, price: Number(table.monthly) || 0, setup: Math.max(0, Number(table.msetupfee) || 0) });
  } else {
    for (const [id, label, months, setupKey] of CYCLES) {
      const price = Number(table[id]);
      if (Number.isFinite(price) && price >= 0) cycles.push({ id, label, months, price, setup: Math.max(0, Number(table[setupKey]) || 0) });
    }
  }
  const monthly = cycles.find((c) => c.id === 'monthly');
  for (const c of cycles) {
    c.perMonth = c.months ? c.price / c.months : c.price;
    const save = monthly && c.months > 1 && monthly.price > 0 ? Math.round((1 - c.perMonth / monthly.price) * 100) : 0;
    c.save = save > 0 ? save : 0;
  }
  return { prefix: table.prefix || '', code: table.suffix || currencyCode, cycles };
}

function decorate(p, currencyCode) {
  const path = storePath(p.product_url);
  const pricing = pricingFor(p, currencyCode);
  const from = pricing.cycles.find((c) => c.id === 'monthly') || pricing.cycles[0] || null;
  return {
    pid: Number(p.pid),
    gid: Number(p.gid),
    name: p.name,
    slug: path ? path.product : p.slug,
    group: path ? path.group : '',
    url: path ? `/store/${path.group}/${path.product}` : '',
    type: p.type,
    kind: kindOf(p.type),
    module: p.module || '',
    ...parseDescription(p.description),
    pricing,
    from,
  };
}

function loadProducts() {
  return cached('products', PRODUCTS_TTL, async () => {
    const data = whmcs.assertSuccess(await whmcs.call('GetProducts', {}));
    return arr(data.products && data.products.product);
  }, { staleMs: HOUR });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Which product slugs of `group` WHMCS lists on its public store.
 * An empty Set is a real answer: the group is hidden (WHMCS redirects within
 * /store) or all of its products are hidden or retired (a store page with no
 * product links). Anything that does not look like a WHMCS store page throws,
 * so an error page is never mistaken for "everything is hidden".
 */
async function fetchVisibleSlugs(group, base = config.whmcsUrl) {
  const res = await axios.get(`${base}/store/${encodeURIComponent(group)}`, {
    timeout: 10000, httpsAgent: ipv4, maxRedirects: 0, responseType: 'text',
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { 'User-Agent': 'SNBDHostPortal/1.0' },
  });
  if (res.status >= 300) {
    const to = String((res.headers && res.headers.location) || '');
    if (/^(https?:\/\/[^/]+)?\/store(\/|$|\?)/.test(to)) return new Set();
    throw new Error(`unexpected redirect (${res.status}) from the store page`);
  }
  const html = String(res.data);
  const own = new RegExp(`href="[^"]*/store/${escapeRe(group)}"`);
  if (!own.test(html)) throw new Error('response is not a WHMCS store page');
  const re = new RegExp(`href="/store/${escapeRe(group)}/([^"?#/]+)"`, 'g');
  return new Set([...html.matchAll(re)].map((m) => decodeURIComponent(m[1])));
}

/**
 * Where to read the public store pages. WHMCS_URL can be an internal origin that
 * only serves the API (production uses http://127.0.0.1:8081, which answers 403 for
 * /store), so the public address is taken from the product URLs WHMCS reports, or
 * from WHMCS_STORE_URL when set.
 */
async function storeBase(group) {
  if (config.whmcsStoreUrl) return config.whmcsStoreUrl;
  try {
    const all = await loadProducts();
    for (const p of all) {
      const m = String(p.product_url || '').match(/^(https?:\/\/[^/]+)\/store\/([^/?#]+)\//);
      if (m && decodeURIComponent(m[2]) === group) return m[1];
    }
    for (const p of all) {
      const m = String(p.product_url || '').match(/^(https?:\/\/[^/]+)\/store\//);
      if (m) return m[1];
    }
  } catch (e) { /* fall back to WHMCS_URL */ }
  return config.whmcsUrl;
}

const SNAPSHOT_FILE = path.join(__dirname, '..', '..', 'data', 'store-visibility.json');
let snapshot = null;

function readSnapshot() {
  if (snapshot) return snapshot;
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    snapshot = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (e) {
    snapshot = {};
  }
  return snapshot;
}

function saveSnapshot(group, slugs) {
  const snap = readSnapshot();
  const next = [...slugs].sort();
  if (snap[group] && JSON.stringify(snap[group].slugs) === JSON.stringify(next)) return;
  snap[group] = { slugs: next, at: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    const tmp = `${SNAPSHOT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
    fs.renameSync(tmp, SNAPSHOT_FILE);
  } catch (e) {
    console.warn(`[catalog] could not save the store visibility snapshot: ${e.message}`);
  }
}

async function syncVisibleSlugs(group) {
  const found = await fetchVisibleSlugs(group, await storeBase(group));
  saveSnapshot(group, found);
  return found;
}

async function visibleSlugs(group) {
  if (config.useMock || !config.whmcsUrl) return null;
  const known = () => {
    const s = readSnapshot()[group];
    return s && Array.isArray(s.slugs) ? new Set(s.slugs) : null;
  };
  if (Date.now() - (visibilityFailedAt.get(group) || 0) < VISIBILITY_RETRY) return known();
  try {
    return await cached(`visibility:${group}`, VISIBILITY_TTL, () => syncVisibleSlugs(group), { staleMs: HOUR });
  } catch (e) {
    console.warn(`[catalog] store visibility sync failed for ${group}: ${e.message}`);
    visibilityFailedAt.set(group, Date.now());
    return known();
  }
}

function groupMeta(slug) {
  return GROUPS.find((g) => g.slug === slug)
    || { slug, name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), family: 'other', blurb: '' };
}

async function getGroup(slug, currencyCode) {
  const [all, visible] = await Promise.all([loadProducts(), visibleSlugs(slug)]);
  const products = all
    .map((p) => decorate(p, currencyCode))
    .filter((p) => p.group === slug && (!visible || visible.has(p.slug)) && p.pricing.cycles.length)
    .sort((a, b) => (a.from ? a.from.perMonth : 0) - (b.from ? b.from.perMonth : 0));
  return { ...groupMeta(slug), products };
}

async function listGroups(currencyCode) {
  const groups = await Promise.all(GROUPS.map((g) => getGroup(g.slug, currencyCode)));
  return groups.filter((g) => g.products.length);
}

async function getProduct(groupSlug, productSlug, currencyCode) {
  const group = await getGroup(groupSlug, currencyCode);
  const product = group.products.find((p) => p.slug === productSlug);
  return product ? { group, product } : null;
}

async function loadTldPrices(currencyid) {
  const data = whmcs.assertSuccess(await whmcs.call('GetTLDPricing', { currencyid }));
  const pricing = data.pricing;
  if (!pricing || typeof pricing !== 'object') throw new Error('GetTLDPricing returned no pricing');
  const map = {};
  for (const [tld, row] of Object.entries(pricing)) {
    const register = row && row.register && Number(row.register['1']);
    const transfer = row && row.transfer && Number(row.transfer['1']);
    map[tld.replace(/^\./, '')] = {
      register: Number.isFinite(register) && register >= 0 ? register : null,
      transfer: Number.isFinite(transfer) && transfer >= 0 ? transfer : null,
    };
  }
  return map;
}

async function getTldPrices(currencyId) {
  const key = String(currencyId || 1);
  return cached(`tld:${key}`, TLD_TTL, () => loadTldPrices(key), { staleMs: 6 * HOUR }).catch(() => ({}));
}

/**
 * Payment gateways the portal offers: only Stripe (credit/debit card) and bKash, whatever else is
 * enabled in WHMCS (PayPal, bank transfer, ...). Matched on the WHMCS module name, e.g. `stripe`
 * and `bkashcheckoutUrl`.
 */
const ALLOWED_GATEWAY = /^(stripe|bkash)/i;
const isAllowedGateway = (m) => ALLOWED_GATEWAY.test(String((m && m.module) || ''));

/** Allowed payment gateways enabled in WHMCS (GetPaymentMethods), or [] when unavailable. */
async function paymentMethods() {
  const data = await cached('paymentmethods', PAYMENT_METHODS_TTL, async () => whmcs.assertSuccess(
    await whmcs.call('GetPaymentMethods', {}),
  )).catch(() => null);
  const v = data && data.paymentmethods && data.paymentmethods.paymentmethod;
  return arr(v).filter(isAllowedGateway);
}

async function siblingsOf(pid, currencyCode) {
  const all = await loadProducts();
  const me = all.find((p) => String(p.pid) === String(pid));
  const path = me && storePath(me.product_url);
  if (!path) return [];
  const group = await getGroup(path.group, currencyCode);
  return group.products.filter((p) => String(p.pid) !== String(pid));
}

const CYCLE_KEY = { monthly: 'monthly', quarterly: 'quarterly', semiannually: 'semiannually', annually: 'annually', biennially: 'biennially', triennially: 'triennially', onetime: 'monthly' };

/** Catalog price of a product for a WHMCS billing cycle label (e.g. "Semi-Annually") in a currency, or null. */
async function productPrice(pid, currencyCode, billingcycle) {
  const all = await loadProducts();
  const p = all.find((x) => String(x.pid) === String(pid));
  const table = p && p.pricing && p.pricing[currencyCode];
  const key = CYCLE_KEY[String(billingcycle || '').toLowerCase().replace(/[^a-z]/g, '')];
  if (!table || !key) return null;
  const v = Number(table[key]);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

module.exports = { productPrice, siblingsOf, GROUPS, FAMILIES, listGroups, getGroup, getProduct, getTldPrices, paymentMethods, loadProducts, visibleSlugs, fetchVisibleSlugs, storeBase, isAllowedGateway, parseDescription, pricingFor, storePath };
