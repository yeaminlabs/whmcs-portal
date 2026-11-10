'use strict';

const crypto = require('crypto');
const config = require('../../config');

const API = 'https://api.stripe.com/v1';

function flatten(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') flatten(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function request(method, path, params, idempotencyKey) {
  const headers = { Authorization: `Bearer ${config.stripe.secretKey}`, 'Stripe-Version': '2024-06-20' };
  let body;
  if (params && method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = flatten(params).toString();
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
    err.code = data.error && data.error.code;
    throw err;
  }
  return data;
}

function createIntent({ amountMinor, currency, invoiceId, clientId, due, fee, email, description }) {
  return request('POST', '/payment_intents', {
    amount: amountMinor,
    currency,
    description,
    receipt_email: email || undefined,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: { source: 'snbd-portal', portal_invoice_id: invoiceId, portal_client_id: clientId, portal_due: due, portal_fee: fee },
  }, `portal-inv-${invoiceId}-${amountMinor}-${Date.now()}`);
}

const retrieveIntent = (id) => request('GET', `/payment_intents/${encodeURIComponent(id)}`);
const cancelIntent = (id) => request('POST', `/payment_intents/${encodeURIComponent(id)}/cancel`, {});

/** Verifies a Stripe-Signature header against the raw request body. */
function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=').map((s) => s.trim())));
  const sigs = String(header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const ts = Number(parts.t);
  if (!ts || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

module.exports = { createIntent, retrieveIntent, cancelIntent, verifyWebhook };
