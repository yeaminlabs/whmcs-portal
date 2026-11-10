'use strict';

/**
 * Every lookup here is scoped to the signed-in client. A record that is
 * missing, belongs to someone else, or cannot be verified returns null,
 * and callers must treat null as "not found".
 */
const whmcs = require('./whmcs');

function firstOf(obj, key) {
  const v = obj && obj[key];
  if (!v) return null;
  const inner = v[Object.keys(v)[0]];
  return Array.isArray(inner) ? inner[0] || null : inner || null;
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

async function safeCall(action, params) {
  try {
    const data = await whmcs.call(action, params, { retries: 2 });
    return data && data.result === 'success' ? data : null;
  } catch (e) {
    return null;
  }
}

async function ownedInvoice(clientId, invoiceid) {
  if (!invoiceid) return null;
  const data = await safeCall('GetInvoice', { invoiceid });
  return data && same(data.userid, clientId) ? data : null;
}

async function ownedService(clientId, serviceid) {
  if (!serviceid) return null;
  const data = await safeCall('GetClientsProducts', { clientid: clientId, serviceid });
  const p = firstOf(data, 'products');
  return p && same(p.id, serviceid) && same(p.clientid, clientId) ? p : null;
}

async function ownedDomain(clientId, domainid) {
  if (!domainid) return null;
  const data = await safeCall('GetClientsDomains', { clientid: clientId, domainid });
  const d = firstOf(data, 'domains');
  return d && same(d.id, domainid) && same(d.userid, clientId) ? d : null;
}

async function ownedQuote(clientId, quoteid) {
  if (!quoteid) return null;
  const data = await safeCall('GetQuotes', { quoteid, userid: clientId });
  const q = firstOf(data, 'quotes');
  return q && same(q.id, quoteid) && same(q.userid, clientId) ? q : null;
}

async function ownedTicket(clientId, ticketid) {
  if (!ticketid) return null;
  const data = await safeCall('GetSupportTicket', { ticketid });
  return data && same(data.userid, clientId) ? data : null;
}

module.exports = { ownedInvoice, ownedService, ownedDomain, ownedQuote, ownedTicket };
