'use strict';

/**
 * WHMCS External API client.
 *
 * Uses node-whmcs (https://github.com/apocas/node-whmcs) as the underlying
 * library — required and instantiated below. API calls are made via direct
 * Axios HTTP requests with WHMCS API identifier/secret authentication, since
 * node-whmcs only supports admin username/password auth and has inconsistent
 * method signatures across modules.
 *
 * Per whmcs-dev-skill: retry with backoff, scrub secrets from logs,
 * wrap every call in try/catch, validate result === 'success'.
 *
 * Only network errors and HTTP 5xx are retried (2 attempts, 300 ms apart).
 * An HTTP 403 means the API role does not allow the action: it is remembered
 * for 10 minutes and answered locally with { result: 'error', blocked: true }.
 */
const http = require('http');
const https = require('https');
const { AsyncLocalStorage } = require('async_hooks');
const { performance } = require('perf_hooks');
const WHMCS = require('whmcs');
const axios = require('axios');
const config = require('../config');

const MOCK = require('./mock');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16, family: 4 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, family: 4 });
const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;
const BLOCK_MS = 10 * 60 * 1000;

const blocked = new Map();

function isBlocked(action) {
  const until = blocked.get(action);
  if (!until) return false;
  if (Date.now() < until) return true;
  blocked.delete(action);
  return false;
}

function markBlocked(action) {
  if (!isBlocked(action)) console.warn(`[WHMCS] ${action} is not allowed by the API role`);
  blocked.set(action, Date.now() + BLOCK_MS);
}

const blockedResult = () => ({ result: 'error', message: 'API action not permitted', blocked: true });

/** Per-request WHMCS stats: number of calls and time (ms) with at least one call in flight. */
const requestStats = new AsyncLocalStorage();

function newStats() {
  return { calls: 0, ms: 0, active: 0, since: 0 };
}

function whmcsMs(stats) {
  return stats.ms + (stats.active ? performance.now() - stats.since : 0);
}

function track() {
  const s = requestStats.getStore();
  if (!s) return () => {};
  s.calls += 1;
  if (s.active++ === 0) s.since = performance.now();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--s.active === 0) s.ms += performance.now() - s.since;
  };
}

const SCRUB_KEYS = new Set(['secret', 'password2', 'password', 'cardnum', 'cccvv', 'accesskey', 'apiSecret']);

function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SCRUB_KEYS.has(k.toLowerCase()) || /secret|password|card|ccv|rootpw|eppcode/i.test(k)
      ? '[REDACTED]'
      : v;
  }
  return out;
}

function logCall(action, params, result) {
  const safeParams = scrub(params);
  const summary = result && result.result ? `result=${result.result}` : 'no-result';
  console.log(`[WHMCS] ${action} ${summary}`, JSON.stringify(safeParams).slice(0, 500));
}

// Instantiate node-whmcs client (username required by constructor, not used for auth)
let whmcsClient = null;
if (!config.useMock && config.whmcsUrl && config.whmcsIdentifier && config.whmcsSecret) {
  try {
    whmcsClient = new WHMCS({
      username: config.whmcsIdentifier,
      serverUrl: config.whmcsUrl,
      userAgent: 'SNBDHostPortal/1.0',
    });
  } catch (e) {
    console.error('[WHMCS] Failed to initialize node-whmcs client:', e.message);
  }
}

class WhmcsClient {
  constructor() {
    this.mock = config.useMock;
    this.client = whmcsClient;
  }

  get live() {
    return !this.mock && this.client !== null;
  }

  isBlocked(action) {
    return isBlocked(action);
  }

  /**
   * `retries` is the number of attempts (capped at 2). `bypassBlocked` sends the
   * request even while the action is marked blocked (used by /health).
   */
  async call(action, params = {}, { retries = MAX_ATTEMPTS, bypassBlocked = false } = {}) {
    if (this.mock) {
      const done = track();
      try {
        const data = MOCK[action] ? await MOCK[action](params) : { result: 'error', message: `Mock not implemented: ${action}` };
        logCall(`${action} (mock)`, params, data);
        return data;
      } finally {
        done();
      }
    }

    if (!this.client) {
      throw new Error('WHMCS client not configured. Set WHMCS_URL, WHMCS_IDENTIFIER, WHMCS_SECRET or enable MOCK_MODE.');
    }

    if (!bypassBlocked && isBlocked(action)) return blockedResult();

    const attempts = Math.min(Math.max(1, Number(retries) || 1), MAX_ATTEMPTS);
    const body = new URLSearchParams({
      identifier: config.whmcsIdentifier,
      secret: config.whmcsSecret,
      action,
      responsetype: 'json',
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v == null ? '' : String(v)])),
    }).toString();

    const done = track();
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await axios.post(`${config.whmcsUrl}/includes/api.php`, body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: TIMEOUT_MS,
            httpAgent,
            httpsAgent,
          });
          const data = res.data;
          logCall(action, { ...params, secret: '[REDACTED]' }, data);
          return data;
        } catch (err) {
          const status = err.response && err.response.status;
          if (status === 403) {
            markBlocked(action);
            return blockedResult();
          }
          logCall(`${action} (attempt ${attempt} failed)`, params, { result: 'error', message: err.message });
          const retryable = !status || status >= 500;
          if (!retryable || attempt >= attempts) {
            throw new Error(`WHMCS API call failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${err.message}`);
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    } finally {
      done();
    }
  }

  assertSuccess(data) {
    if (!data || data.result !== 'success') {
      throw new Error(data && data.message ? data.message : 'WHMCS API error');
    }
    return data;
  }
}

module.exports = new WhmcsClient();
module.exports.scrub = scrub;
module.exports.requestStats = requestStats;
module.exports.newStats = newStats;
module.exports.whmcsMs = whmcsMs;
