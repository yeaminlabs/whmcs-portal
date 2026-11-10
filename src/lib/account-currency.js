'use strict';

/**
 * Switches a client's WHMCS account currency the way an admin would by hand:
 * convert every amount that belongs to the account, then change the currency.
 *
 * WHMCS stores no currency on invoices, services, domains or addons, so they are
 * converted in place with convertCurrency() maths. Accounts with any money
 * history (payments, credit, paid/refunded/part-paid invoices) are refused,
 * because their past records would be relabelled. If any update fails, the
 * already-applied changes are reverted and the currency is left unchanged.
 */
const whmcs = require('./whmcs');
const currency = require('./currency');
const catalog = require('./catalog');

const listOf = (obj, key) => {
  const v = obj && obj[key];
  if (!v) return [];
  const inner = v[Object.keys(v)[0]];
  return !inner ? [] : Array.isArray(inner) ? inner : [inner];
};
const ok = (d) => d && d.result === 'success';
const CONVERTIBLE_INVOICE = new Set(['Unpaid', 'Draft', 'Cancelled']);
const running = new Set();

async function call(action, params) {
  const data = await whmcs.call(action, params, { retries: 2 });
  if (!ok(data)) throw new Error(`${action}: ${(data && data.message) || 'failed'}`);
  return data;
}

async function plan(clientId, to) {
  const list = await currency.listCurrencies();
  const details = await call('GetClientsDetails', { clientid: clientId });
  const client = details.client || {};
  const from = list.find((c) => String(c.id) === String(client.currency)) || list[0];
  if (from.id === to.id) return { ok: false, reason: 'same', from, to };
  if (!from.rate || !to.rate) return { ok: false, reason: 'rate', from, to };
  if (Math.abs(Number(client.credit) || 0) > 0.001) return { ok: false, reason: 'credit', from, to };

  const [tx, inv, svc, dom, addons] = await Promise.all([
    call('GetTransactions', { clientid: clientId }),
    call('GetInvoices', { userid: clientId, limitnum: 1000 }),
    call('GetClientsProducts', { clientid: clientId, limitnum: 1000 }),
    call('GetClientsDomains', { clientid: clientId, limitnum: 1000 }),
    call('GetClientsAddons', { clientid: clientId }),
  ]);
  if (Number(tx.totalresults) > 0) return { ok: false, reason: 'payments', from, to };
  const invoices = listOf(inv, 'invoices');
  if (invoices.some((i) => !CONVERTIBLE_INVOICE.has(i.status))) return { ok: false, reason: 'paid', from, to };

  const conv = (v) => currency.convertAmount(Number(v) || 0, from, to);
  const invoiceChanges = [];
  for (const i of invoices) {
    const full = await call('GetInvoice', { invoiceid: i.id });
    if (Number(full.credit) > 0.001 || Number(full.balance) < Number(full.total) - 0.001) return { ok: false, reason: 'paid', from, to };
    const items = listOf(full, 'items').map((it) => ({ id: it.id, type: it.type, relid: it.relid, description: it.description, taxed: it.taxed, amount: Number(it.amount) || 0 }));
    invoiceChanges.push({ invoiceid: i.id, items });
  }

  // Services priced at the catalog rate get the catalog price in the new currency
  // (what WHMCS "recalculate" does); custom-priced ones are converted.
  const services = [];
  for (const s of listOf(svc, 'products')) {
    const recurring = Number(s.recurringamount) || 0;
    const first = Number(s.firstpaymentamount) || 0;
    const [oldList, newList] = await Promise.all([
      catalog.productPrice(s.pid, from.code, s.billingcycle).catch(() => null),
      catalog.productPrice(s.pid, to.code, s.billingcycle).catch(() => null),
    ]);
    const atList = oldList != null && newList != null && Math.abs(oldList - recurring) < 0.005;
    services.push({ id: s.id, recurring, first, newRecurring: atList ? newList : conv(recurring), newFirst: atList && Math.abs(first - recurring) < 0.005 ? newList : conv(first) });
  }
  const svcById = new Map(services.map((s) => [String(s.id), s]));
  for (const inv of invoiceChanges) {
    for (const it of inv.items) {
      const s = it.type === 'Hosting' ? svcById.get(String(it.relid)) : null;
      it.newAmount = s && Math.abs(it.amount - s.recurring) < 0.005 ? s.newRecurring : conv(it.amount);
    }
  }

  return {
    ok: true, from, to, clientId,
    services,
    domains: listOf(dom, 'domains').map((d) => ({ id: d.id, recurring: Number(d.recurringamount) || 0, first: Number(d.firstpaymentamount) || 0 })),
    addons: listOf(addons, 'addons').map((a) => ({ id: a.id, recurring: Number(a.recurring) || 0, setup: Number(a.setupfee) || 0 })),
    invoices: invoiceChanges,
    conv,
  };
}

function invoiceParams(invoiceid, items, pick) {
  const params = { invoiceid };
  for (const it of items) {
    params[`itemdescription[${it.id}]`] = it.description;
    params[`itemamount[${it.id}]`] = pick(it).toFixed(2);
    params[`itemtaxed[${it.id}]`] = String(it.taxed) === '1' || it.taxed === true ? '1' : '0';
  }
  return params;
}

async function apply(p) {
  const undo = [];
  try {
    for (const s of p.services) {
      await call('UpdateClientProduct', { serviceid: s.id, recurringamount: s.newRecurring.toFixed(2), firstpaymentamount: s.newFirst.toFixed(2) });
      undo.push(() => call('UpdateClientProduct', { serviceid: s.id, recurringamount: s.recurring.toFixed(2), firstpaymentamount: s.first.toFixed(2) }));
    }
    for (const d of p.domains) {
      await call('UpdateClientDomain', { domainid: d.id, recurringamount: p.conv(d.recurring).toFixed(2), firstpaymentamount: p.conv(d.first).toFixed(2) });
      undo.push(() => call('UpdateClientDomain', { domainid: d.id, recurringamount: d.recurring.toFixed(2), firstpaymentamount: d.first.toFixed(2) }));
    }
    for (const a of p.addons) {
      await call('UpdateClientAddon', { id: a.id, recurring: p.conv(a.recurring).toFixed(2), setupfee: p.conv(a.setup).toFixed(2) });
      undo.push(() => call('UpdateClientAddon', { id: a.id, recurring: a.recurring.toFixed(2), setupfee: a.setup.toFixed(2) }));
    }
    for (const inv of p.invoices) {
      if (!inv.items.length) continue;
      await call('UpdateInvoice', invoiceParams(inv.invoiceid, inv.items, (it) => it.newAmount));
      undo.push(() => call('UpdateInvoice', invoiceParams(inv.invoiceid, inv.items, (it) => it.amount)));
    }
    await call('UpdateClient', { clientid: p.clientId, currency: p.to.id });
  } catch (e) {
    for (const fn of undo.reverse()) {
      await fn().catch((err) => console.error('[currency] rollback step failed:', err.message));
    }
    throw e;
  }
}

/**
 * Returns { switched: true } on success, or { switched: false, reason } when the
 * account is not eligible ('paid' | 'payments' | 'credit' | 'same' | 'rate' | 'busy').
 */
async function switchAccountCurrency(clientId, to) {
  if (running.has(clientId)) return { switched: false, reason: 'busy' };
  running.add(clientId);
  try {
    const p = await plan(clientId, to);
    if (!p.ok) return { switched: false, reason: p.reason };
    await apply(p);
    console.log(`[currency] client ${clientId}: ${p.from.code} -> ${p.to.code} (${p.services.length} services, ${p.domains.length} domains, ${p.addons.length} addons, ${p.invoices.length} invoices)`);
    return { switched: true, from: p.from, to: p.to };
  } finally {
    running.delete(clientId);
  }
}

module.exports = { switchAccountCurrency };
