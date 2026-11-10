'use strict';

/**
 * Shared helpers for in-portal payments: currency conversion that matches the
 * WHMCS "convert to" gateway setting, and idempotent AddInvoicePayment.
 */
const whmcs = require('../whmcs');
const currency = require('../currency');
const { invalidateClient } = require('../client');

const locks = new Map();

/** Rate to convert an amount from the client's currency into the gateway's currency, like WHMCS does. */
async function conversion(clientCurrencyId, gatewayCurrencyId) {
  const list = await currency.listCurrencies();
  const from = list.find((c) => String(c.id) === String(clientCurrencyId));
  const to = list.find((c) => String(c.id) === String(gatewayCurrencyId)) || from;
  if (!from || !to || from.id === to.id || !from.rate || !to.rate) return { rate: 1, currency: from || to };
  return { rate: to.rate / from.rate, currency: to };
}

async function alreadyRecorded(transid) {
  const data = await whmcs.call('GetTransactions', { transid }).catch(() => null);
  return Boolean(data && data.result === 'success' && Number(data.totalresults) > 0);
}

/**
 * Records a payment once. Concurrent calls for the same transaction (return page
 * + webhook) are serialised, and an existing transaction ID is never added twice.
 */
async function recordPayment({ invoiceid, transid, gateway, amount, fees = 0, clientId = null }) {
  const key = `${gateway}:${transid}`;
  while (locks.has(key)) await locks.get(key).catch(() => {});
  const job = (async () => {
    if (await alreadyRecorded(transid)) return { recorded: false, duplicate: true };
    const data = await whmcs.call('AddInvoicePayment', {
      invoiceid, transid, gateway,
      amount: Number(amount).toFixed(2),
      fees: Number(fees || 0).toFixed(2),
      date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }, { retries: 1 });
    invalidateClient(clientId);
    if (data.result !== 'success') throw new Error(data.message || 'WHMCS did not accept the payment');
    return { recorded: true };
  })();
  locks.set(key, job);
  try {
    return await job;
  } finally {
    locks.delete(key);
  }
}

module.exports = { conversion, recordPayment, alreadyRecorded };
