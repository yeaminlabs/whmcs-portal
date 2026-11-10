'use strict';

/**
 * Store — mirrors portal.snbdhost.com/store order flow:
 *   group page → configure (domain step for hosting, server fields for VPS,
 *   billing cycle for all) → AddOrder → pay invoice.
 *
 * Browsing and configuring are public. A guest's configured order waits in
 * the session (pendingOrder) until they log in or register at /checkout.
 */
const express = require('express');
const whmcs = require('../lib/whmcs');
const catalog = require('../lib/catalog');
const { requireLogin } = require('../middleware/auth');
const { cleanStr, cleanInt } = require('../lib/validators');
const currency = require('../lib/currency');
const { invalidateClient } = require('../lib/client');
const { applyPrefs } = require('../lib/prefs');

const router = express.Router();

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HOSTNAME_RE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NS_PREFIX_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
const PENDING_TTL = 2 * 60 * 60 * 1000;

function normalizeDomain(v) {
  return cleanStr(v, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function tldOf(domain) {
  return domain.split('.').slice(1).join('.');
}

const queryStr = (v) => (typeof v === 'string' ? v : '');

/** Guests have no account currency, so they are billed in the display currency. */
async function currencies(req) {
  const account = (await currency.accountCurrency(req)) || req.displayCurrency;
  const display = req.displayCurrency || account;
  return { account, display, differs: display.code !== account.code };
}

const paymentMethods = () => catalog.paymentMethods();

router.use(['/store', '/checkout'], (req, res, next) => {
  res.locals.publicPage = !req.session.clientId;
  next();
});

/** `?cur=` / `?lang=` on a public link: store the preference, then drop it from the URL. */
async function prefsFromQuery(req, res, next) {
  if (req.query.cur == null && req.query.lang == null) return next();
  try {
    await applyPrefs(req, res, { cur: queryStr(req.query.cur), lang: queryStr(req.query.lang) });
  } catch (e) {
    console.warn('[store] prefs from query:', e.message);
  }
  const url = new URL(req.originalUrl, 'http://portal.invalid');
  url.searchParams.delete('cur');
  url.searchParams.delete('lang');
  res.redirect(302, url.pathname + url.search);
}

/** WHMCS-style links (/order?pid=, /cart.php?a=add&pid=) → the canonical configure page. */
router.get(['/order', '/cart.php', '/cart'], async (req, res) => {
  try {
    await applyPrefs(req, res, { cur: queryStr(req.query.cur), lang: queryStr(req.query.lang) });
    const pid = cleanInt(queryStr(req.query.pid));
    if (!pid) return res.redirect(302, '/store');
    const groups = await catalog.listGroups(req.displayCurrency.code);
    for (const group of groups) {
      const product = group.products.find((p) => p.pid === pid);
      if (!product) continue;
      const wanted = queryStr(req.query.cycle || req.query.billingcycle).toLowerCase();
      const cycle = product.pricing.cycles.find((c) => c.id === wanted);
      const url = `/store/${encodeURIComponent(group.slug)}/${encodeURIComponent(product.slug)}`;
      return res.redirect(302, cycle ? `${url}?cycle=${cycle.id}` : url);
    }
    res.redirect(302, '/store');
  } catch (e) {
    res.redirect(302, '/store');
  }
});

router.get('/store', prefsFromQuery, async (req, res) => {
  try {
    const { display } = await currencies(req);
    const groups = await catalog.listGroups(display.code);
    res.render('store', { title: 'Order Services', groups, families: catalog.FAMILIES });
  } catch (e) {
    res.render('error', { title: 'Order Services', message: `Could not load the store: ${e.message}`, back: '/' });
  }
});

router.get('/store/complete', requireLogin, (req, res) => {
  const order = req.session.lastOrder;
  if (!order) return res.redirect('/store');
  res.render('store-complete', { title: 'Order Complete', order });
});

router.post('/store/domain-check', async (req, res) => {
  const domain = normalizeDomain(req.body && req.body.domain);
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ ok: false, error: res.locals.t('dom.invalid') });
  try {
    const { display } = await currencies(req);
    const [whois, tlds] = await Promise.all([
      whmcs.call('DomainWhois', { domain }),
      catalog.getTldPrices(display.id),
    ]);
    if (whois.result !== 'success') throw new Error(whois.message || 'Lookup failed');
    const price = tlds[tldOf(domain)] || null;
    res.json({ ok: true, domain, available: whois.status === 'available', register: price && price.register, transfer: price && price.transfer });
  } catch (e) {
    res.status(502).json({ ok: false, error: res.locals.t('conf.checkFail') });
  }
});

router.get('/store/:group', prefsFromQuery, async (req, res) => {
  try {
    const { display } = await currencies(req);
    const [group, groups] = await Promise.all([
      catalog.getGroup(req.params.group, display.code),
      catalog.listGroups(display.code),
    ]);
    if (!group.products.length) {
      return res.status(404).render('error', { title: 'Not found', message: 'That product category is not available.', back: '/store' });
    }
    res.render('store-group', { title: 'Order Services', group, groups, families: catalog.FAMILIES });
  } catch (e) {
    res.render('error', { title: 'Order Services', message: `Could not load plans: ${e.message}`, back: '/store' });
  }
});

async function renderConfigure(req, res, { form = {}, error = null, status = 200 } = {}) {
  const { account, display, differs } = await currencies(req);
  const found = await catalog.getProduct(req.params.group, req.params.product, display.code);
  if (!found) {
    return res.status(404).render('error', { title: 'Not found', message: 'That plan is not available to order.', back: '/store' });
  }
  const hosting = found.product.kind === 'hosting';
  const [methods, tlds, billFound, billTlds] = await Promise.all([
    paymentMethods(),
    hosting ? catalog.getTldPrices(display.id) : Promise.resolve({}),
    differs ? catalog.getProduct(req.params.group, req.params.product, account.code) : Promise.resolve(null),
    differs && hosting ? catalog.getTldPrices(account.id) : Promise.resolve(null),
  ]);
  const billing = billFound ? {
    code: account.code,
    prefix: billFound.product.pricing.prefix,
    cycles: Object.fromEntries(billFound.product.pricing.cycles.map((c) => [c.id, { price: c.price, setup: c.setup }])),
    tlds: billTlds || {},
  } : null;
  res.status(status).render('store-configure', {
    title: 'Order Services', group: found.group, product: found.product,
    paymethods: methods, tlds, billing, form: withoutSecrets(form), error,
  });
}

function readForm(b = {}) {
  return {
    billingcycle: cleanStr(b.billingcycle, 20),
    paymentmethod: cleanStr(b.paymentmethod, 60),
    domainoption: cleanStr(b.domainoption, 20),
    domain: normalizeDomain(b.domain),
    eppcode: cleanStr(b.eppcode, 100),
    hostname: cleanStr(b.hostname, 253).toLowerCase(),
    rootpw: typeof b.rootpw === 'string' ? b.rootpw : '',
    ns1prefix: cleanStr(b.ns1prefix || 'ns1', 30).toLowerCase(),
    ns2prefix: cleanStr(b.ns2prefix || 'ns2', 30).toLowerCase(),
    promocode: cleanStr(b.promocode, 50),
  };
}

const withoutSecrets = ({ rootpw, eppcode, ...rest }) => rest;

/** A guest's configured order, or null. An expired one is dropped with a notice. */
function pendingOrder(req) {
  const p = req.session.pendingOrder;
  if (p && Date.now() - Number(p.createdAt) < PENDING_TTL) return p;
  if (p) {
    delete req.session.pendingOrder;
    req.session.flash = { type: 'info', key: 'checkout.expired' };
  }
  return null;
}

/**
 * Checks an order the way WHMCS will, without anything client-specific, and
 * builds the AddOrder parameters (minus clientid). Throws with a user-facing message.
 */
async function validateOrder(t, { group, product: productSlug, form }, currencyCode) {
  const found = await catalog.getProduct(group, productSlug, currencyCode);
  if (!found) throw new Error(t('err.planGone'));
  const { product } = found;

  const cycle = product.pricing.cycles.find((c) => c.id === form.billingcycle);
  if (!cycle) throw new Error(t('err.chooseCycle'));
  const methods = await paymentMethods();
  if (!methods.some((m) => m.module === form.paymentmethod)) throw new Error(t('err.choosePayment'));

  const params = {
    paymentmethod: form.paymentmethod,
    'pid[0]': String(product.pid),
    'billingcycle[0]': cycle.id,
  };
  if (form.promocode) params.promocode = form.promocode;

  if (product.kind === 'hosting') {
    if (!['register', 'transfer', 'owndomain'].includes(form.domainoption)) throw new Error(t('err.chooseDomain'));
    if (!DOMAIN_RE.test(form.domain)) throw new Error(t('dom.invalid'));
    params['domain[0]'] = form.domain;
    if (form.domainoption === 'register') {
      const whois = await whmcs.call('DomainWhois', { domain: form.domain });
      if (whois.result !== 'success') throw new Error(t('conf.checkFail'));
      if (whois.status !== 'available') throw new Error(t('conf.taken', { domain: form.domain }));
      params['domaintype[0]'] = 'register';
      params['regperiod[0]'] = '1';
    } else if (form.domainoption === 'transfer') {
      params['domaintype[0]'] = 'transfer';
      params['regperiod[0]'] = '1';
      if (form.eppcode) params['eppcode[0]'] = form.eppcode;
    }
  } else if (product.kind === 'server') {
    const { rootpw } = form;
    if (!HOSTNAME_RE.test(form.hostname)) throw new Error(t('err.hostname'));
    if (rootpw.length < 8 || rootpw.length > 64 || !/[a-z]/.test(rootpw) || !/[A-Z]/.test(rootpw) || !/[0-9]/.test(rootpw)) {
      throw new Error(t('err.rootpw'));
    }
    if (!NS_PREFIX_RE.test(form.ns1prefix) || !NS_PREFIX_RE.test(form.ns2prefix)) throw new Error(t('err.nsPrefix'));
    params['hostname[0]'] = form.hostname;
    params['rootpw[0]'] = rootpw;
    params['ns1prefix[0]'] = form.ns1prefix;
    params['ns2prefix[0]'] = form.ns2prefix;
  }
  return { found, cycle, params };
}

const placing = new Map();

/**
 * Validates and places the signed-in client's order (AddOrder), billed in their
 * account currency. A second submit from the same session while the first is
 * still running gets the first one's result instead of a duplicate order.
 */
function placeOrder(req, t, order) {
  const key = req.sessionID;
  if (placing.has(key)) return placing.get(key);
  const run = (async () => {
    const { account } = await currencies(req);
    const { params } = await validateOrder(t, order, account.code);
    const data = await whmcs.call('AddOrder', { clientid: req.session.clientId, ...params });
    invalidateClient(req.session.clientId);
    if (data.result !== 'success') throw new Error(data.message || t('err.orderFailed'));
    return data;
  })().finally(() => placing.delete(key));
  placing.set(key, run);
  return run;
}

/** Like WHMCS, a placed order continues to its invoice's payment page. */
function afterOrder(req, res, data) {
  req.session.flash = { type: 'ok', key: 'checkout.placed', vars: { order: data.orderid } };
  res.redirect(303, Number(data.invoiceid) > 0 ? `/invoices/${Number(data.invoiceid)}/pay` : '/services');
}

router.get('/store/:group/:product', prefsFromQuery, async (req, res) => {
  try {
    const p = req.session.pendingOrder;
    const resume = p && p.group === req.params.group && p.product === req.params.product
      && Date.now() - Number(p.createdAt) < PENDING_TTL;
    const form = resume ? { ...p.form } : {};
    if (req.query.cycle || !resume) form.billingcycle = req.query.cycle;
    await renderConfigure(req, res, { form });
  } catch (e) {
    res.render('error', { title: 'Order Services', message: `Could not load this plan: ${e.message}`, back: '/store' });
  }
});

router.post('/store/:group/:product', async (req, res) => {
  const t = res.locals.t;
  const form = readForm(req.body);
  const order = { group: req.params.group, product: req.params.product, form };
  try {
    if (!req.session.clientId) {
      const { account } = await currencies(req);
      const { found } = await validateOrder(t, order, account.code);
      req.session.pendingOrder = { group: found.group.slug, product: found.product.slug, form, createdAt: Date.now() };
      return res.redirect(303, '/checkout');
    }
    afterOrder(req, res, await placeOrder(req, t, order));
  } catch (e) {
    try {
      await renderConfigure(req, res, { form, error: e.message, status: 422 });
    } catch (err) {
      res.render('error', { title: 'Order Services', message: e.message, back: '/store' });
    }
  }
});

/** The checkout summary for a pending order in the display currency, or null when it can no longer be ordered. */
async function checkoutLocals(req, t, pending) {
  const { account, display, differs } = await currencies(req);
  const [found, methods] = await Promise.all([
    catalog.getProduct(pending.group, pending.product, display.code),
    paymentMethods(),
  ]);
  if (!found) return null;
  const { group, product } = found;
  const f = pending.form || {};
  const cycle = product.pricing.cycles.find((c) => c.id === f.billingcycle);
  if (!cycle) return null;
  const method = methods.find((m) => m.module === f.paymentmethod);
  const domainKey = { register: 'checkout.domainRegister', transfer: 'checkout.domainTransfer', owndomain: 'checkout.domainOwn' }[f.domainoption];
  return {
    order: {
      group: { slug: group.slug, name: group.name },
      product: { slug: product.slug, name: product.name, kind: product.kind },
      cycle: { id: cycle.id, label: cycle.label, price: cycle.price, setup: cycle.setup },
      prefix: product.pricing.prefix,
      code: product.pricing.code,
      domainLine: product.kind === 'hosting' && f.domain && domainKey ? t(domainKey, { domain: f.domain }) : null,
      hostname: product.kind === 'server' && f.hostname ? f.hostname : null,
      paymentmethod: { module: f.paymentmethod, name: method ? String(method.displayname || method.module).split('|')[0].trim() : f.paymentmethod },
      total: cycle.price + cycle.setup,
      editUrl: `/store/${encodeURIComponent(group.slug)}/${encodeURIComponent(product.slug)}?cycle=${cycle.id}`,
    },
    billedNote: req.session.clientId && differs ? t('checkout.billedIn', { code: account.code }) : null,
  };
}

async function renderCheckout(req, res, pending, error = null, status = 200) {
  const t = res.locals.t;
  const locals = await checkoutLocals(req, t, pending);
  if (!locals) {
    delete req.session.pendingOrder;
    req.session.flash = { type: 'err', key: 'checkout.gone' };
    return res.redirect(303, '/store');
  }
  res.status(status).render('checkout', {
    title: 'Checkout', loggedIn: Boolean(req.session.clientId), error, next: '/checkout', ...locals,
  });
}

router.get('/checkout', async (req, res) => {
  const pending = pendingOrder(req);
  if (!pending) return res.redirect('/store');
  try {
    await renderCheckout(req, res, pending);
  } catch (e) {
    res.render('error', { title: 'Checkout', message: res.locals.t('checkout.loadFail'), back: '/store' });
  }
});

router.post('/checkout', async (req, res) => {
  if (!req.session.clientId) return res.redirect(303, '/login?next=/checkout');
  const pending = pendingOrder(req);
  if (!pending) return res.redirect(303, '/store');
  const t = res.locals.t;
  try {
    const data = await placeOrder(req, t, pending);
    delete req.session.pendingOrder;
    afterOrder(req, res, data);
  } catch (e) {
    try {
      await renderCheckout(req, res, pending, e.message, 422);
    } catch (err) {
      res.render('error', { title: 'Checkout', message: e.message, back: '/store' });
    }
  }
});

module.exports = router;
