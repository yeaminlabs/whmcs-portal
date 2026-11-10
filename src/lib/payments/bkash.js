'use strict';

/** bKash Tokenized Checkout (v1.2.0-beta), the same API the WHMCS bkashcheckoutUrl module uses. */
const config = require('../../config');

const base = () => (config.bkash.sandbox
  ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout'
  : 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout');

let token = { value: null, expiresAt: 0 };

async function post(path, body, headers) {
  const res = await fetch(base() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.statusMessage || data.errorMessage || `bKash error ${res.status}`);
  return data;
}

async function grantToken() {
  if (token.value && Date.now() < token.expiresAt) return token.value;
  const data = await post('/token/grant', { app_key: config.bkash.appKey, app_secret: config.bkash.appSecret }, {
    username: config.bkash.username,
    password: config.bkash.password,
  });
  if (!data.id_token) throw new Error(data.statusMessage || data.msg || 'bKash did not issue a token');
  token = { value: data.id_token, expiresAt: Date.now() + (Math.max(60, Number(data.expires_in) || 3600) - 300) * 1000 };
  return token.value;
}

async function authed(path, body) {
  const auth = await grantToken();
  return post(path, body, { Authorization: auth, 'X-APP-Key': config.bkash.appKey });
}

async function createPayment({ amount, invoiceId, callbackURL, payerReference }) {
  const data = await authed('/create', {
    mode: '0011',
    payerReference: payerReference || ' ',
    callbackURL,
    amount: amount.toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: `${invoiceId}-${Math.floor(1000000 + Math.random() * 8999999)}`,
  });
  if (!data.paymentID || !data.bkashURL) throw new Error(data.statusMessage || 'bKash could not start the payment');
  return data;
}

const executePayment = (paymentID) => authed('/execute', { paymentID });
const queryPayment = (paymentID) => authed('/payment/status', { paymentID });

module.exports = { createPayment, executePayment, queryPayment, grantToken };
