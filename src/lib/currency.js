'use strict';

/**
 * Currencies come from WHMCS (GetCurrencies). Conversion and formatting follow
 * WHMCS itself: convertCurrency() is amount / fromRate * toRate rounded to 2
 * decimals, and the currency "format" setting picks the number style.
 *
 * WHMCS stores no currency on invoices, services or domains; they always use
 * the client's account currency. Only a never-billed account can switch it.
 */
const whmcs = require('./whmcs');
const { cached } = require('./cache');
const { getClient } = require('./client');

const TTL = 10 * 60 * 1000;
const STALE = 60 * 60 * 1000;

const arr = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

async function loadCurrencies() {
  const data = whmcs.assertSuccess(await whmcs.call('GetCurrencies', {}));
  const list = arr(data.currencies && data.currencies.currency).map((c) => ({
    id: Number(c.id),
    code: String(c.code),
    prefix: c.prefix || '',
    suffix: c.suffix || '',
    format: Number(c.format) || 1,
    rate: Number(c.rate) > 0 ? Number(c.rate) : null,
  }));
  if (!list.length) throw new Error('GetCurrencies returned no currencies');
  return list;
}

async function listCurrencies() {
  const list = await cached('currencies', TTL, loadCurrencies, { staleMs: STALE }).catch(() => null);
  return list || [{ id: 1, code: 'BDT', prefix: '৳', suffix: 'BDT', format: 2, rate: 1 }];
}

async function accountCurrency(req) {
  if (!req.session || !req.session.clientId) return null;
  if (req.session.currency && req.session.currency.code) return req.session.currency;
  const [details, list] = await Promise.all([
    getClient(req).catch(() => null),
    listCurrencies(),
  ]);
  const client = (details && details.client) || {};
  const cur = list.find((c) => String(c.id) === String(client.currency))
    || list.find((c) => c.code === client.currency_code)
    || list[0];
  req.session.currency = { id: cur.id, code: cur.code, prefix: cur.prefix };
  return req.session.currency;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** WHMCS currency format: 1 = 1234.56, 2 = 1,234.56, 3 = 1.234,56, 4 = 1,234 */
function formatNumber(amount, fmt) {
  const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  if (fmt === 4) return Math.round(n).toLocaleString('en-US');
  const fixed = round2(n).toFixed(2);
  if (fmt === 1) return fixed;
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, fmt === 3 ? '.' : ',');
  return fmt === 3 ? `${grouped},${dec}` : `${grouped}.${dec}`;
}

function format(amount, cur) {
  return (cur.prefix || '') + formatNumber(amount, cur.format || 2);
}

/** WHMCS convertCurrency(): amount / from.rate * to.rate, rounded to 2 decimals. */
function convertAmount(amount, from, to) {
  if (!from || !to || from.code === to.code) return round2(amount);
  if (!from.rate || !to.rate) return null;
  return round2((Number(amount) || 0) / from.rate * to.rate);
}

/** View helpers bound to the request's display currency. */
function helpers(list, display, account) {
  const byCode = new Map(list.map((c) => [c.code, c]));
  const byPrefix = new Map(list.map((c) => [c.prefix, c]));
  const bill = account ? byCode.get(account.code) || display : display;
  return {
    /** Amount already in `code` (or the currency owning `prefix`), formatted like WHMCS. */
    fmt: (amount, code) => format(amount, byCode.get(code) || display),
    money: (amount, prefix = '') => format(amount, byPrefix.get(prefix) || { prefix, format: 2 }),
    /** Amount billed in `fromCode` (default: account currency), shown in the display currency. */
    price: (amount, fromCode) => {
      const from = byCode.get(fromCode) || bill;
      const v = convertAmount(amount, from, display);
      return v == null ? format(amount, from) : format(v, display);
    },
    /** Same amount in its billing currency, or null when it equals the display currency. */
    billedAs: (amount, fromCode) => {
      const from = byCode.get(fromCode) || bill;
      return from.code === display.code ? null : format(amount, from);
    },
    convert: (amount, fromCode) => {
      const from = byCode.get(fromCode);
      const v = convertAmount(amount, from, display);
      return v == null ? null : format(v, display);
    },
  };
}

module.exports = { listCurrencies, accountCurrency, helpers, format, formatNumber, convertAmount };
