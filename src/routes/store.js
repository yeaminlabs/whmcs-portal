'use strict';

/**
 * Store — mirrors portal.snbdhost.com/store order flow:
 *   group page → configure (domain step for hosting, server fields for VPS,
 *   billing cycle for all) → AddOrder → order complete → pay invoice.
 */
const express = require('express');
const whmcs = require('../lib/whmcs');
const catalog = require('../lib/catalog');
const { requireLogin } = require('../middleware/auth');
const { cleanStr } = require('../lib/validators');
const currency = require('../lib/currency');
const { invalidateClient } = require('../lib/client');

const router = express.Router();
router.use('/store', requireLogin);

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HOSTNAME_RE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NS_PREFIX_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

function normalizeDomain(v) {
  return cleanStr(v, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function tldOf(domain) {
  return domain.split('.').slice(1).join('.');
}

async function currencies(req) {
  const account = (await currency.accountCurrency(req)) || req.displayCurrency;
  const display = req.displayCurrency || account;
  return { account, display, differs: display.code !== account.code };
}

const paymentMethods = () => catalog.paymentMethods();

router.get('/store', async (req, res) => {
  try {
    const { display } = await currencies(req);
    const groups = await catalog.listGroups(display.code);
    res.render('store', { title: 'Order Services', groups, families: catalog.FAMILIES });
  } catch (e) {
    res.render('error', { title: 'Order Services', message: `Could not load the store: ${e.message}`, back: '/' });
  }
});

router.get('/store/complete', (req, res) => {
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

router.get('/store/:group', async (req, res) => {
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
    paymethods: methods, tlds, billing, form, error,
  });
}

router.get('/store/:group/:product', async (req, res) => {
  try {
    await renderConfigure(req, res, { form: { billingcycle: req.query.cycle } });
  } catch (e) {
    res.render('error', { title: 'Order Services', message: `Could not load this plan: ${e.message}`, back: '/store' });
  }
});

router.post('/store/:group/:product', async (req, res) => {
  const b = req.body || {};
  const t = res.locals.t;
  const form = {
    billingcycle: cleanStr(b.billingcycle, 20),
    paymentmethod: cleanStr(b.paymentmethod, 60),
    domainoption: cleanStr(b.domainoption, 20),
    domain: normalizeDomain(b.domain),
    hostname: cleanStr(b.hostname, 253).toLowerCase(),
    ns1prefix: cleanStr(b.ns1prefix || 'ns1', 30).toLowerCase(),
    ns2prefix: cleanStr(b.ns2prefix || 'ns2', 30).toLowerCase(),
    promocode: cleanStr(b.promocode, 50),
  };
  try {
    const { account } = await currencies(req);
    const found = await catalog.getProduct(req.params.group, req.params.product, account.code);
    if (!found) throw new Error(t('err.planGone'));
    const { product } = found;

    const cycle = product.pricing.cycles.find((c) => c.id === form.billingcycle);
    if (!cycle) throw new Error(t('err.chooseCycle'));
    const methods = await paymentMethods();
    if (!methods.some((m) => m.module === form.paymentmethod)) throw new Error(t('err.choosePayment'));

    const params = {
      clientid: req.session.clientId,
      paymentmethod: form.paymentmethod,
      'pid[0]': String(product.pid),
      'billingcycle[0]': cycle.id,
    };
    if (form.promocode) params.promocode = form.promocode;

    let domainLine = null;
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
        domainLine = `Register ${form.domain} (1 year)`;
      } else if (form.domainoption === 'transfer') {
        const epp = cleanStr(b.eppcode, 100);
        params['domaintype[0]'] = 'transfer';
        params['regperiod[0]'] = '1';
        if (epp) params['eppcode[0]'] = epp;
        domainLine = `Transfer ${form.domain}`;
      }
    } else if (product.kind === 'server') {
      const rootpw = String(b.rootpw || '');
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

    const data = await whmcs.call('AddOrder', params);
    invalidateClient(req.session.clientId);
    if (data.result !== 'success') throw new Error(data.message || t('err.orderFailed'));

    req.session.lastOrder = {
      orderid: data.orderid,
      invoiceid: data.invoiceid,
      product: product.name,
      group: found.group.name,
      kind: product.kind,
      cycle: cycle.label,
      price: cycle.price,
      setup: cycle.setup,
      prefix: product.pricing.prefix,
      code: product.pricing.code,
      domain: form.domain || form.hostname || '',
      domainLine,
    };
    res.redirect(303, '/store/complete');
  } catch (e) {
    try {
      await renderConfigure(req, res, { form, error: e.message, status: 422 });
    } catch (err) {
      res.render('error', { title: 'Order Services', message: e.message, back: '/store' });
    }
  }
});

module.exports = router;
