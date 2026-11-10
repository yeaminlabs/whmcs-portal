'use strict';

/**
 * Signed client for the WHMCS addon `snbd_portal_bridge` (docs/BRIDGE_CONTRACT.md).
 * bridge(op, body) resolves with the response `data` or throws an Error whose
 * `.code` is one of the contract codes (auth, bad_request, not_found, not_active,
 * not_allowed, confirm_required, module_error, internal) or `network`.
 */
const crypto = require('crypto');
const https = require('https');
const axios = require('axios');
const config = require('../config');

const READ_OPS = new Set(['ping', 'batch', 'dashboard', 'service.view']);
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 15000;
const RETRYABLE = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

const agent = new https.Agent({ keepAlive: true, maxSockets: 16, family: 4 });

function bridgeError(code, message, status) {
  const err = new Error(message || code);
  err.code = code;
  if (status) err.status = status;
  return err;
}

function sign(rawBody) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', config.bridge.secret).update(`${ts}.${nonce}.${rawBody}`).digest('hex');
  return { 'X-Bridge-Ts': ts, 'X-Bridge-Nonce': nonce, 'X-Bridge-Sig': sig };
}

async function post(rawBody) {
  return axios.post(config.bridge.url, rawBody, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...sign(rawBody) },
    httpsAgent: agent,
    timeout: TIMEOUT_MS,
    transformRequest: [(d) => d],
    validateStatus: () => true,
    maxRedirects: 0,
  });
}

function unwrap(res) {
  const body = res.data;
  if (body && typeof body === 'object' && typeof body.ok === 'boolean') {
    if (body.ok) return body.data;
    const e = body.error || {};
    throw bridgeError(e.code || 'internal', e.message || 'Bridge error', res.status);
  }
  if (res.status === 401) throw bridgeError('auth', 'Bridge rejected the signature', 401);
  if (res.status === 400) throw bridgeError('bad_request', 'Bridge rejected the request', 400);
  throw bridgeError('internal', `Bridge returned HTTP ${res.status}`, res.status);
}

async function live(op, body) {
  const rawBody = JSON.stringify({ ...body, op });
  if (Buffer.byteLength(rawBody) > MAX_BODY) throw bridgeError('bad_request', 'Request body too large');
  const attempts = READ_OPS.has(op) ? 2 : 1;
  for (let i = 1; ; i += 1) {
    let res;
    try {
      res = await post(rawBody);
    } catch (err) {
      if (i < attempts && !err.response && RETRYABLE.has(err.code)) continue;
      console.warn(`[bridge] ${op} network error: ${err.code || err.message}`);
      throw bridgeError('network', 'Could not reach WHMCS');
    }
    return unwrap(res);
  }
}

async function bridge(op, body = {}) {
  if (config.useMock) return require('./mock-bridge')(op, body);
  if (!config.bridge.secret) throw bridgeError('internal', 'Bridge is not configured');
  return live(op, body);
}

module.exports = { bridge, bridgeError, READ_OPS };
