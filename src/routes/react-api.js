'use strict';
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const whmcs = require('../lib/whmcs');
const { getClient } = require('../lib/client');
const gtokens = require('../lib/google-tokens');
const router = express.Router();
const listOf = (obj, key) => {
  const value = obj && obj[key];
  if (!value) return [];
  const inner = value[Object.keys(value)[0]];
  return !inner ? [] : (Array.isArray(inner) ? inner : [inner]);
};

// Public OAuth client identifier only; credentials remain server-side.
router.get('/config', (req, res) => res.json({ googleClientId: require('../config').googleClientId }));

// React migration v1: authenticated, read-only dashboard payload. WHMCS keys stay server-side.
router.get('/dashboard', requireLogin, async (req, res) => {
  const clientId = Number(req.session.clientId);
  try {
    const ticketsAllowed = !whmcs.isBlocked('GetSupportTickets');
    const [details, products, domains, invoices, tickets] = await Promise.all([
      getClient(req).catch(() => null),
      whmcs.call('GetClientsProducts', { clientid: clientId }).catch(() => null),
      whmcs.call('GetClientsDomains', { clientid: clientId }).catch(() => null),
      whmcs.call('GetInvoices', { userid: clientId, limitnum: 5 }).catch(() => null),
      ticketsAllowed ? whmcs.call('GetSupportTickets', { clientid: clientId }).catch(() => null) : null,
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      customer: (details && details.client) || { fullname: req.session.clientName, email: req.session.clientEmail },
      stats: (details && details.stats) || {},
      services: listOf(products, 'products').slice(0, 5),
      domains: listOf(domains, 'domains').slice(0, 5),
      invoices: listOf(invoices, 'invoices').slice(0, 5),
      tickets: listOf(tickets, 'tickets').slice(0, 5),
      ticketsUnavailable: !ticketsAllowed || Boolean(tickets && tickets.blocked),
      googleTools: gtokens.tools(clientId),
    });
  } catch (error) {
    res.status(502).json({ error: 'dashboard_unavailable', message: 'Could not load dashboard data.' });
  }
});
module.exports = router;
