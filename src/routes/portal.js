'use strict';

const express = require('express');
const axios = require('axios');
const https = require('https');
const whmcs = require('../lib/whmcs');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');
const { cleanStr, cleanInt } = require('../lib/validators');
const catalog = require('../lib/catalog');
const pay = require('./pay');
const avatars = require('../lib/avatars');
const { ownedInvoice, ownedService, ownedDomain, ownedQuote, ownedTicket } = require('../lib/ownership');
const { cached } = require('../lib/cache');
const { getClient, invalidateClient } = require('../lib/client');

const router = express.Router();
const GOOGLE_CLIENT_ID = config.googleClientId;

const MIN = 60 * 1000;
/** Global (not per-client) WHMCS lookups, cached; null when WHMCS fails and nothing is cached. */
const globalData = (action, ttlMs) => cached(`api:${action}`, ttlMs, async () => whmcs.assertSuccess(await whmcs.call(action, {}))).catch(() => null);

// Public health check (no login) — uses GetCurrencies per skill lightweight check
router.get('/health', async (req, res) => {
  try {
    const data = await whmcs.call('GetCurrencies', {}, { bypassBlocked: true });
    res.json({ ok: data.result === 'success', mock: require('../config').useMock, result: data.result });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'WHMCS unreachable' });
  }
});

// Public register (parity with register.php) — must be before requireLogin
router.get('/register', (req, res) => res.render('register', { title: 'Register', error: null }));
router.post('/register', async (req, res) => {
  try {
    const data = await whmcs.call('AddClient', {
      firstname: cleanStr(req.body.firstname, 100), lastname: cleanStr(req.body.lastname, 100),
      email: cleanStr(req.body.email, 190), password2: String(req.body.password || ''),
      address1: 'NA', city: 'NA', state: 'NA', postcode: '0000', country: 'US', phonenumber: '000',
    });
    if (data.result !== 'success') throw new Error(data.message || 'Registration failed');
    res.redirect('/login');
  } catch (e) { res.render('register', { title: 'Register', error: e.message }); }
});

/** Google profile photo URL from the ID token, accepted only from Google's image host. */
function googlePicture(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(u.hostname) ? u.href.slice(0, 500) : null;
  } catch (e) {
    return null;
  }
}

// ---- Google login (verifies Google ID token via Google's public endpoint) ----
router.post('/auth/google', async (req, res) => {
  const idToken = cleanStr(req.body.id_token, 2000);
  if (!idToken) {
    return res.status(400).json({ error: 'Missing id_token' });
  }
  try {
    let payload;
    try {
      const verify = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
        params: { id_token: idToken },
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4 }),
      });
      payload = verify.data;
    } catch (err) {
      return res.status(400).json({ error: 'Google could not verify this sign-in. Please try again.' });
    }
    if (payload.aud !== GOOGLE_CLIENT_ID) {
      return res.status(400).json({ error: 'Invalid audience' });
    }
    if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
      return res.status(400).json({ error: 'Invalid issuer' });
    }
    if (payload.exp && parseInt(payload.exp, 10) < Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: 'Token expired' });
    }
    const email = String(payload.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    if (String(payload.email_verified) !== 'true') {
      return res.status(400).json({ error: 'Your Google email is not verified.' });
    }

    // Look up client in WHMCS by email
    const data = await whmcs.call('GetClientsDetails', { email });
    if (data.result !== 'success') {
      return res.status(404).json({ error: `No SNBD HOST account uses ${email}. Sign in with your email and password, or create an account first.` });
    }
    const client = data.client || {};
    const clientId = client.id || client.clientid || client.userid;
    if (!clientId) throw new Error('WHMCS did not return a client id.');

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not start session.' });
      req.session.clientId = Number(clientId);
      req.session.clientName = `${client.firstname || ''} ${client.lastname || ''}`.trim() || email;
      req.session.clientEmail = client.email || email;
      req.session.clientPicture = googlePicture(payload.picture) || avatars.get(clientId);
      avatars.set(clientId, googlePicture(payload.picture));
      res.json({ ok: true, redirect: '/' });
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Google sign in failed' });
  }
});

router.use(requireLogin);

function listOf(obj, key) {
  // WHMCS returns { items: { item: [...] } } or single object
  if (!obj) return [];
  const v = obj[key];
  if (!v) return [];
  const inner = v[Object.keys(v)[0]];
  if (!inner) return [];
  return Array.isArray(inner) ? inner : [inner];
}

router.get('/', async (req, res) => {
  try {
    const cid = req.session.clientId;
    const ticketsAllowed = !whmcs.isBlocked('GetSupportTickets');
    const [details, products, domains, invoices, tickets] = await Promise.all([
      getClient(req).catch(() => null),
      whmcs.call('GetClientsProducts', { clientid: cid }).catch(() => null),
      whmcs.call('GetClientsDomains', { clientid: cid }).catch(() => null),
      whmcs.call('GetInvoices', { userid: cid, limitnum: 5 }).catch(() => null),
      ticketsAllowed ? whmcs.call('GetSupportTickets', { clientid: cid }).catch(() => null) : null,
    ]);
    res.render('dashboard', {
      title: 'Dashboard',
      customer: (details && details.client) || { fullname: req.session.clientName, email: req.session.clientEmail },
      stats: (details && details.stats) || {},
      services: listOf(products, 'products').slice(0, 5),
      domains: listOf(domains, 'domains').slice(0, 5),
      invoices: listOf(invoices, 'invoices').slice(0, 5),
      tickets: listOf(tickets, 'tickets').slice(0, 5),
      ticketsUnavailable: !ticketsAllowed || Boolean(tickets && tickets.blocked),
    });
  } catch (e) {
    res.render('error', { title: 'Dashboard', message: 'Could not load dashboard data.', back: '/login' });
  }
});

router.get('/services', async (req, res) => {
  try {
    const data = await whmcs.call('GetClientsProducts', { clientid: req.session.clientId });
    whmcs.assertSuccess(data);
    res.render('services', { title: 'My Services', services: listOf(data, 'products') });
  } catch (e) {
    res.render('error', { title: 'Services', message: e.message, back: '/' });
  }
});

router.get('/domains', async (req, res) => {
  try {
    const data = await whmcs.call('GetClientsDomains', { clientid: req.session.clientId });
    whmcs.assertSuccess(data);
    res.render('domains', { title: 'My Domains', domains: listOf(data, 'domains') });
  } catch (e) {
    res.render('error', { title: 'Domains', message: e.message, back: '/' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const data = await whmcs.call('GetInvoices', { userid: req.session.clientId, limitnum: 50 });
    whmcs.assertSuccess(data);
    res.render('invoices', { title: 'My Invoices', invoices: listOf(data, 'invoices') });
  } catch (e) {
    res.render('error', { title: 'Invoices', message: e.message, back: '/' });
  }
});

const notFound = (res, back) => res.status(404).render('error', { title: 'Not found', message: 'We could not find that in your account.', back });

router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await ownedInvoice(req.session.clientId, cleanInt(req.params.id));
    if (!invoice) return notFound(res, '/invoices');
    const items = invoice.items && invoice.items.item ? (Array.isArray(invoice.items.item) ? invoice.items.item : [invoice.items.item]) : [];
    res.render('invoice', { title: `Invoice #${invoice.invoicenum || invoice.invoiceid}`, invoice, items, notice: ['credit', 'card', 'bkash', 'processing', 'check'].includes(req.query.paid) ? req.query.paid : null });
  } catch (e) {
    res.render('error', { title: 'Invoice', message: e.message, back: '/invoices' });
  }
});

const ticketsUnavailable = (res) => res.render('tickets', { title: 'Support Tickets', tickets: [], ticketsUnavailable: true });

router.get('/tickets', async (req, res) => {
  try {
    if (whmcs.isBlocked('GetSupportTickets')) return ticketsUnavailable(res);
    const data = await whmcs.call('GetSupportTickets', { clientid: req.session.clientId });
    if (data && data.blocked) return ticketsUnavailable(res);
    whmcs.assertSuccess(data);
    res.render('tickets', { title: 'Support Tickets', tickets: listOf(data, 'tickets') });
  } catch (e) {
    res.render('error', { title: 'Tickets', message: e.message, back: '/' });
  }
});

router.get('/tickets/new', async (req, res) => {
  try {
    const depts = await globalData('GetSupportDepartments', 60 * MIN);
    res.render('ticket-new', { title: 'Open Ticket', error: null, departments: listOf(depts, 'departments') });
  } catch (e) {
    res.render('ticket-new', { title: 'Open Ticket', error: e.message, departments: [] });
  }
});

router.post('/tickets/new', async (req, res) => {
  try {
    const deptid = cleanInt(req.body.deptid, 1);
    const subject = cleanStr(req.body.subject, 200);
    const message = cleanStr(req.body.message, 5000);
    const priority = ['Low', 'Medium', 'High'].includes(req.body.priority) ? req.body.priority : 'Medium';
    if (!subject || !message) {
      return res.status(400).render('ticket-new', { title: 'Open Ticket', error: 'Subject and message are required.', departments: [] });
    }
    const data = await whmcs.call('OpenTicket', {
      clientid: req.session.clientId,
      deptid, subject, message, priority,
      contactid: '', admin: false,
    });
    if (data.result !== 'success') {
      return res.status(400).render('ticket-new', { title: 'Open Ticket', error: data.message || 'Could not open ticket.', departments: [] });
    }
    res.redirect('/tickets');
  } catch (e) {
    res.status(500).render('ticket-new', { title: 'Open Ticket', error: e.message, departments: [] });
  }
});

router.get('/tickets/:id', async (req, res) => {
  try {
    if (whmcs.isBlocked('GetSupportTicket')) return ticketsUnavailable(res);
    const ticket = await ownedTicket(req.session.clientId, cleanInt(req.params.id));
    if (!ticket && whmcs.isBlocked('GetSupportTicket')) return ticketsUnavailable(res);
    if (!ticket) return notFound(res, '/tickets');
    const replies = ticket.replies && ticket.replies.reply ? (Array.isArray(ticket.replies.reply) ? ticket.replies.reply : [ticket.replies.reply]) : [];
    res.render('ticket', { title: ticket.subject || `Ticket #${ticket.tid || ticket.ticketid}`, ticket, replies, error: null });
  } catch (e) {
    res.render('error', { title: 'Ticket', message: e.message, back: '/tickets' });
  }
});

router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const ticket = await ownedTicket(req.session.clientId, cleanInt(req.params.id));
    if (!ticket) return notFound(res, '/tickets');
    const message = cleanStr(req.body.message, 5000);
    if (!message) return res.redirect(`/tickets/${ticket.ticketid}`);
    const data = await whmcs.call('AddTicketReply', { ticketid: ticket.ticketid, message, clientid: req.session.clientId });
    if (data.result !== 'success') throw new Error(data.message || 'Reply failed');
    res.redirect(`/tickets/${ticket.ticketid}`);
  } catch (e) {
    res.render('error', { title: 'Reply failed', message: e.message, back: '/tickets' });
  }
});

router.get('/cart', (req, res) => res.redirect(301, '/store'));
router.post('/cart', (req, res) => res.redirect(303, '/store'));

// Domain order: search (DomainWhois) → register (AddOrder) in the client's billing currency
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const POPULAR_TLDS = ['com', 'net', 'org', 'xyz', 'com.bd', 'info', 'online', 'site', 'store', 'io'];

async function renderDomainOrder(req, res, extra = {}, status = 200) {
  const display = res.locals.displayCurrency;
  const account = res.locals.accountCurrency || display;
  const [tlds, paymethods] = await Promise.all([
    catalog.getTldPrices(display.id),
    catalog.paymentMethods(),
  ]);
  const popular = POPULAR_TLDS.filter((x) => tlds[x] && tlds[x].register != null).map((x) => ({ tld: x, ...tlds[x] }));
  res.status(status).render('domain-order', {
    title: 'Order Domain', popular, prefix: display.prefix, billCode: account.code,
    paymethods, result: null, query: '', error: null, ...extra,
  });
}

router.get('/order/domain', async (req, res) => {
  try { await renderDomainOrder(req, res); } catch (e) { res.render('error', { title: 'Order Domain', message: e.message, back: '/' }); }
});

router.post('/order/domain/check', async (req, res) => {
  const t = res.locals.t;
  let query = cleanStr(req.body.domain, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (query && !query.includes('.')) query += '.com';
  try {
    if (!DOMAIN_RE.test(query)) return renderDomainOrder(req, res, { query, error: t('dom.invalid') }, 422);
    const whois = await whmcs.call('DomainWhois', { domain: query });
    if (whois.result !== 'success') return renderDomainOrder(req, res, { query, error: t('conf.checkFail') }, 502);
    const tlds = await catalog.getTldPrices(res.locals.displayCurrency.id);
    const tld = query.split('.').slice(1).join('.');
    await renderDomainOrder(req, res, { query, result: { domain: query, available: whois.status === 'available', price: tlds[tld] || null } });
  } catch (e) { res.render('error', { title: 'Order Domain', message: e.message, back: '/order/domain' }); }
});

router.post('/order/domain', async (req, res) => {
  const t = res.locals.t;
  const domain = cleanStr(req.body.domain, 253).toLowerCase();
  try {
    if (!DOMAIN_RE.test(domain)) return renderDomainOrder(req, res, { error: t('dom.invalid') }, 422);
    const regperiod = ['1', '2', '3', '5', '10'].includes(String(req.body.regperiod)) ? String(req.body.regperiod) : '1';
    const methods = await catalog.paymentMethods();
    const paymentmethod = cleanStr(req.body.paymentmethod, 60);
    if (!methods.some((m) => m.module === paymentmethod)) return renderDomainOrder(req, res, { query: domain, error: t('err.choosePayment') }, 422);
    const whois = await whmcs.call('DomainWhois', { domain });
    if (whois.result !== 'success' || whois.status !== 'available') return renderDomainOrder(req, res, { query: domain, error: t('conf.taken', { domain }) }, 422);
    const data = await whmcs.call('AddOrder', {
      clientid: req.session.clientId, paymentmethod,
      'domain[0]': domain, 'domaintype[0]': 'register', 'regperiod[0]': regperiod,
    });
    invalidateClient(req.session.clientId);
    if (data.result !== 'success') throw new Error(data.message || t('err.orderFailed'));
    res.redirect(303, `/invoices/${data.invoiceid}/pay`);
  } catch (e) { renderDomainOrder(req, res, { query: domain, error: e.message }, 500).catch(() => res.render('error', { title: 'Order Domain', message: e.message, back: '/order/domain' })); }
});

router.get('/announcements', async (req, res) => {
  try {
    const data = await globalData('GetAnnouncements', 10 * MIN);
    const items = (() => {
      if (!data || !data.announcements) return [];
      const v = data.announcements.announcement;
      return Array.isArray(v) ? v : [v];
    })();
    res.render('announcements', { title: 'Announcements', items });
  } catch (e) {
    res.render('error', { title: 'Announcements', message: e.message, back: '/' });
  }
});

router.get('/kb', async (req, res) => {
  try {
    const data = await globalData('GetKBArticles', 10 * MIN);
    const items = (() => {
      if (!data || !data.articles) return [];
      const v = data.articles.article;
      return Array.isArray(v) ? v : [v];
    })();
    res.render('kb', { title: 'Help Center', items });
  } catch (e) {
    res.render('error', { title: 'Help Center', message: e.message, back: '/' });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const data = await getClient(req);
    res.render('profile', { title: 'Profile', customer: (data && data.client) || {}, updated: req.query.updated === '1', error: null });
  } catch (e) {
    res.render('error', { title: 'Profile', message: e.message, back: '/' });
  }
});

router.post('/profile', async (req, res) => {
  try {
    const fields = {
      clientid: req.session.clientId,
      firstname: cleanStr(req.body.firstname, 100),
      lastname: cleanStr(req.body.lastname, 100),
      email: cleanStr(req.body.email, 190),
      phonenumber: cleanStr(req.body.phonenumber, 50),
      address1: cleanStr(req.body.address1, 200),
      city: cleanStr(req.body.city, 100),
      postcode: cleanStr(req.body.postcode, 30),
      country: cleanStr(req.body.country, 2),
    };
    const data = await whmcs.call('UpdateClient', fields);
    invalidateClient(req.session.clientId);
    if (data.result !== 'success') throw new Error(data.message || 'Update failed');
    res.redirect('/profile?updated=1');
  } catch (e) {
    res.render('profile', { title: 'Profile', customer: req.body, updated: false, error: e.message });
  }
});


// ---- Full parity with portal.snbdhost.com ----
// Service detail + upgrade + cancel (snbdpanel / Hetzner / Proxmox style services)
router.get('/services/:id', async (req, res) => {
  try {
    const code = res.locals.displayCurrency.code;
    // siblingsOf needs the service's pid, so the catalog it reads is loaded alongside the ownership check.
    const [service] = await Promise.all([
      ownedService(req.session.clientId, cleanInt(req.params.id)),
      catalog.listGroups(code).catch(() => null),
    ]);
    if (!service) return notFound(res, '/services');
    const upgrades = await catalog.siblingsOf(service.pid, code).catch(() => []);
    res.render('service-detail', { title: service.name || 'Service', service, upgrades, ordered: null, error: null });
  } catch (e) { res.render('error', { title: 'Service', message: e.message, back: '/services' }); }
});
router.post('/services/:id/upgrade', async (req, res) => {
  try {
    const service = await ownedService(req.session.clientId, cleanInt(req.params.id));
    if (!service) return notFound(res, '/services');
    const data = await whmcs.call('UpgradeProduct', { serviceid: service.id, type: 'product', newproductid: cleanInt(req.body.newpid), newproductbillingcycle: service.billingcycle ? String(service.billingcycle).toLowerCase().replace(/[^a-z]/g, '') : 'monthly', paymentmethod: service.paymentmethod });
    if (data.result !== 'success') throw new Error(data.message || 'Upgrade failed');
    res.render('service-detail', { title: service.name || 'Service', service, upgrades: [], ordered: data, error: null });
  } catch (e) { res.render('error', { title: 'Upgrade failed', message: e.message, back: '/services' }); }
});
router.post('/services/:id/cancel', async (req, res) => {
  try {
    const service = await ownedService(req.session.clientId, cleanInt(req.params.id));
    if (!service) return notFound(res, '/services');
    const type = req.body.type === 'Immediate' ? 'Immediate' : 'End of Billing Period';
    const data = await whmcs.call('AddCancelRequest', { serviceid: service.id, type, reason: cleanStr(req.body.reason || 'No longer needed', 500) });
    if (data.result !== 'success') throw new Error(data.message || 'Cancellation request failed');
    res.redirect('/services');
  } catch (e) { res.render('error', { title: 'Cancel failed', message: e.message, back: '/services' }); }
});

// Domain detail: nameservers / lock / renew
async function fetchDomainExtras(domainid) {
  const [ns, lock] = await Promise.all([
    whmcs.call('DomainGetNameservers', { domainid }, { retries: 1 }).catch(() => null),
    whmcs.call('DomainGetLockingStatus', { domainid }, { retries: 1 }).catch(() => null),
  ]);
  return {
    nameservers: ns && ns.result === 'success' ? [1, 2, 3, 4, 5].map((n) => ns[`ns${n}`]).filter(Boolean) : null,
    lockstatus: lock && lock.result === 'success' ? lock.lockstatus : null,
  };
}
async function domainExtras(domain) {
  return Object.assign(domain, await fetchDomainExtras(domain.id));
}
router.get('/domains/:id', async (req, res) => {
  try {
    const id = cleanInt(req.params.id);
    const [domain, extras] = await Promise.all([
      ownedDomain(req.session.clientId, id),
      id ? fetchDomainExtras(id) : null,
    ]);
    if (!domain) return notFound(res, '/domains');
    Object.assign(domain, extras);
    res.render('domain-detail', { title: domain.domainname || 'Domain', domain, error: null, saved: req.query.saved === '1' });
  } catch (e) { res.render('error', { title: 'Domain', message: e.message, back: '/domains' }); }
});
router.post('/domains/:id/ns', async (req, res) => {
  try {
    const domain = await ownedDomain(req.session.clientId, cleanInt(req.params.id));
    if (!domain) return notFound(res, '/domains');
    const ns = [1, 2, 3, 4, 5].map((n) => cleanStr(req.body[`ns${n}`], 253).toLowerCase()).filter(Boolean);
    if (ns.length < 2 || ns.some((h) => !/^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(h))) {
      await domainExtras(domain);
      return res.status(422).render('domain-detail', { title: domain.domainname || 'Domain', domain, error: res.locals.t('dom.nsInvalid'), saved: false });
    }
    const params = { domainid: domain.id };
    ns.forEach((h, i) => { params[`ns${i + 1}`] = h; });
    const data = await whmcs.call('DomainUpdateNameservers', params);
    if (data.result !== 'success') throw new Error(data.message || 'Nameserver update failed');
    res.redirect(`/domains/${domain.id}?saved=1`);
  } catch (e) { res.render('error', { title: 'Nameservers', message: e.message, back: '/domains' }); }
});
router.post('/domains/:id/lock', async (req, res) => {
  try {
    const domain = await ownedDomain(req.session.clientId, cleanInt(req.params.id));
    if (!domain) return notFound(res, '/domains');
    const data = await whmcs.call('DomainUpdateLockingStatus', { domainid: domain.id, lockstatus: req.body.lock === '0' ? '0' : '1' });
    if (data.result !== 'success') throw new Error(data.message || 'Could not change the lock');
    res.redirect(`/domains/${domain.id}?saved=1`);
  } catch (e) { res.render('error', { title: 'Lock', message: e.message, back: '/domains' }); }
});
router.post('/domains/:id/renew', async (req, res) => {
  try {
    const domain = await ownedDomain(req.session.clientId, cleanInt(req.params.id));
    if (!domain) return notFound(res, '/domains');
    const data = await whmcs.call('RenewDomain', { domainid: domain.id, regperiod: '1' });
    if (data.result !== 'success') throw new Error(data.message || 'Renew failed');
    res.redirect('/invoices');
  } catch (e) { res.render('error', { title: 'Renew', message: e.message, back: '/domains' }); }
});

// Quotes, pay, funds, emails, contacts, security
router.get('/quotes', async (req, res) => {
  const data = await whmcs.call('GetQuotes', { userid: req.session.clientId }).catch(() => null);
  const list = data && data.quotes ? (Array.isArray(data.quotes.quote) ? data.quotes.quote : [data.quotes.quote]) : [];
  res.render('quotes', { title: 'Quotes', quotes: list });
});
router.post('/quotes/:id/accept', async (req, res) => {
  try {
    const quote = await ownedQuote(req.session.clientId, cleanInt(req.params.id));
    if (!quote) return notFound(res, '/quotes');
    const data = await whmcs.call('AcceptQuote', { quoteid: quote.id });
    if (data.result !== 'success') throw new Error(data.message || 'Could not accept the quote');
    res.redirect(data.invoiceid ? `/invoices/${data.invoiceid}/pay` : '/invoices');
  } catch (e) { res.render('error', { title: 'Quote', message: e.message, back: '/quotes' }); }
});

// Payments run inside WHMCS's own gateway modules (bKash, Stripe, PayPal...),
// so the client is handed to the WHMCS invoice page with a one-time SSO login.
async function ssoRedirect(clientId, path) {
  const data = await whmcs.call('CreateSsoToken', { client_id: clientId, destination: 'sso:custom_redirect', sso_redirect_path: path });
  if (data.result !== 'success' || !data.redirect_url) throw new Error(data.message || 'SSO_FAILED');
  return data.redirect_url;
}

async function clientCredit(req) {
  const d = await getClient(req).catch(() => null);
  return Number(d && d.client && d.client.credit) || 0;
}

async function renderPay(req, res, invoice, error = null, status = 200) {
  const [paymethods, credit, card, bkash] = await Promise.all([
    catalog.paymentMethods(),
    clientCredit(req),
    config.stripe.enabled ? pay.stripeAmount(invoice).catch(() => null) : null,
    config.bkash.enabled ? pay.bkashAmounts(invoice).catch(() => null) : null,
  ]);
  const inApp = [config.stripe.enabled && pay.STRIPE_GATEWAY, config.bkash.enabled && pay.BKASH_GATEWAY].filter(Boolean);
  const failed = ['card', 'bkash', 'bkash-cancel'].includes(req.query.failed) ? req.query.failed : null;
  const charges = {};
  if (card) charges[pay.STRIPE_GATEWAY] = { amount: card.charge, code: card.currency.code };
  if (bkash) charges[pay.BKASH_GATEWAY] = { amount: bkash.total, code: 'BDT', feePercent: config.bkash.feePercent };
  res.status(status).render('invoice-pay', { title: 'Pay Invoice', invoice, paymethods, credit, error, inApp, failed, charges });
}

router.get('/invoices/:id/pay', async (req, res) => {
  try {
    const invoice = await ownedInvoice(req.session.clientId, cleanInt(req.params.id));
    if (!invoice) return notFound(res, '/invoices');
    if (invoice.status !== 'Unpaid') return res.redirect(`/invoices/${invoice.invoiceid}`);
    await renderPay(req, res, invoice);
  } catch (e) { res.render('error', { title: 'Pay Invoice', message: e.message, back: '/invoices' }); }
});

router.post('/invoices/:id/pay', async (req, res) => {
  let invoice = null;
  try {
    invoice = await ownedInvoice(req.session.clientId, cleanInt(req.params.id));
    if (!invoice) return notFound(res, '/invoices');
    if (invoice.status !== 'Unpaid') return res.redirect(`/invoices/${invoice.invoiceid}`);
    const method = cleanStr(req.body.paymentmethod, 60);

    if (method === 'credit') {
      const credit = await clientCredit(req);
      const amount = Math.min(credit, Number(invoice.balance) || 0);
      if (amount <= 0) throw new Error(res.locals.t('err.noCredit'));
      const data = await whmcs.call('ApplyCredit', { invoiceid: invoice.invoiceid, amount: amount.toFixed(2) });
      invalidateClient(req.session.clientId);
      if (data.result !== 'success') throw new Error(data.message || res.locals.t('err.creditFail'));
      return res.redirect(303, `/invoices/${invoice.invoiceid}?paid=credit`);
    }

    const methods = await catalog.paymentMethods();
    if (!methods.some((m) => m.module === method)) throw new Error(res.locals.t('err.choosePayment'));
    if (method === pay.STRIPE_GATEWAY && config.stripe.enabled) return res.redirect(303, `/invoices/${invoice.invoiceid}/pay/card`);
    if (method === pay.BKASH_GATEWAY && config.bkash.enabled) {
      return pay.startBkash(req, res, invoice).catch((err) => {
        console.error('[pay] bkash start failed:', err.message);
        return renderPay(req, res, invoice, res.locals.t('pay.bkashUnavailable'), 502);
      });
    }
    if (invoice.paymentmethod !== method) {
      const upd = await whmcs.call('UpdateInvoice', { invoiceid: invoice.invoiceid, paymentmethod: method });
      if (upd.result !== 'success') throw new Error(upd.message || res.locals.t('err.switchMethod'));
    }
    res.redirect(303, await ssoRedirect(req.session.clientId, `viewinvoice.php?id=${invoice.invoiceid}`));
  } catch (e) {
    if (!invoice) return res.render('error', { title: 'Pay Invoice', message: e.message, back: '/invoices' });
    await renderPay(req, res, invoice, e.message === 'SSO_FAILED' ? res.locals.t('err.sso') : e.message, 422).catch(() => res.render('error', { title: 'Pay Invoice', message: e.message, back: '/invoices' }));
  }
});

router.get('/funds', async (req, res) => {
  res.render('funds', { title: 'Add Funds', credit: await clientCredit(req), error: null });
});
router.post('/funds', async (req, res) => {
  try {
    res.redirect(303, await ssoRedirect(req.session.clientId, 'clientarea.php?action=addfunds'));
  } catch (e) {
    res.render('funds', { title: 'Add Funds', credit: await clientCredit(req), error: e.message === 'SSO_FAILED' ? res.locals.t('err.sso') : e.message });
  }
});
router.get('/emails', async (req, res) => {
  const data = await whmcs.call('GetEmails', { clientid: req.session.clientId }).catch(() => null);
  const list = data && data.emails ? (Array.isArray(data.emails.email) ? data.emails.email : [data.emails.email]) : [];
  res.render('emails', { title: 'Email History', emails: list });
});
router.get('/contacts', async (req, res) => {
  const data = await whmcs.call('GetContacts', { clientid: req.session.clientId }).catch(() => null);
  const list = data && data.contacts ? (Array.isArray(data.contacts.contact) ? data.contacts.contact : [data.contacts.contact]) : [];
  res.render('contacts', { title: 'Contacts', contacts: list });
});
router.get('/security', (req, res) => res.render('security', { title: 'Security', error: null, done: false }));
router.post('/security', async (req, res) => {
  const fail = (error) => res.status(422).render('security', { title: 'Security', error, done: false });
  try {
    const current = String(req.body.currentpw || '');
    const next = String(req.body.newpw || '');
    if (next.length < 8 || !/[a-z]/i.test(next) || !/[0-9]/.test(next)) return fail(res.locals.t('sec.rule'));
    if (next !== String(req.body.confirmpw || '')) return fail(res.locals.t('err.pwMatch'));
    const check = await whmcs.call('ValidateLogin', { email: req.session.clientEmail, password2: current });
    if (check.result !== 'success') return fail(res.locals.t('err.pwCurrent'));
    const data = await whmcs.call('UpdateClient', { clientid: req.session.clientId, password2: next });
    if (data.result !== 'success') return fail(data.message || res.locals.t('err.pwFail'));
    res.render('security', { title: 'Security', error: null, done: true });
  } catch (e) { fail(res.locals.t('err.pwFail')); }
});
router.post('/tickets/:id/close', async (req, res) => {
  try {
    const ticket = await ownedTicket(req.session.clientId, cleanInt(req.params.id));
    if (!ticket) return notFound(res, '/tickets');
    await whmcs.call('UpdateTicket', { ticketid: ticket.ticketid, status: 'Closed' });
    res.redirect('/tickets');
  } catch (e) { res.render('error', { title: 'Ticket', message: e.message, back: '/tickets' }); }
});

// Downloads, status, contact, affiliates (parity with live theme)
router.get('/downloads', async (req, res) => {
  const data = await globalData('GetDownloads', 60 * MIN);
  const list = data && data.downloads ? (Array.isArray(data.downloads.download) ? data.downloads.download : [data.downloads.download]) : [];
  res.render('downloads', { title: 'Downloads', items: list });
});
const uptimerobot = require('../lib/uptimerobot');
const mockUptime = require('../lib/mock-uptime');

/** MOCK_MODE always uses fixtures; implicit mock mode (no WHMCS credentials) only when UptimeRobot is not configured. */
const networkStatus = () => (config.mockMode || (config.useMock && !config.uptimerobot.enabled)
  ? Promise.resolve(mockUptime.buildMockStatus())
  : uptimerobot.getStatus());

router.get('/status', async (req, res) => {
  const status = await networkStatus();
  res.render('status', { title: 'Network Status', status, servers: [] });
});
router.get('/status.json', async (req, res) => {
  const status = await networkStatus();
  res.set('Cache-Control', 'no-store').json(status);
});
router.get('/contact', (req, res) => res.render('contact', { title: 'Contact', error: null, done: false }));
router.post('/contact', async (req, res) => {
  await whmcs.call('SendContact', { name: cleanStr(req.body.name, 100), email: cleanStr(req.body.email, 190), message: cleanStr(req.body.message, 2000) }).catch(() => null);
  res.render('contact', { title: 'Contact', error: null, done: true });
});
router.get('/affiliates', async (req, res) => {
  const data = await whmcs.call('GetAffiliates', { clientid: req.session.clientId }).catch(() => null);
  res.render('affiliates', { title: 'Affiliates', info: (data && data.affiliates) || null });
});

module.exports = router;

