'use strict';

/**
 * Lightweight HTTP probe using Node's built-in fetch. No extra deps.
 */
async function probe(url, timeoutMs) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
    const ms = Date.now() - t0;
    const code = res.status;
    const ok = code >= 200 && code < 400;
    return { status: ok ? 'up' : 'down', ms, code, error: ok ? null : `HTTP ${code}` };
  } catch (e) {
    const ms = Date.now() - t0;
    return { status: 'down', ms, code: null, error: (e && e.message) ? e.message.slice(0, 200) : 'request failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probe };
