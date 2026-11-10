'use strict';

/**
 * In-process cache with stale-while-revalidate.
 *
 * cached(key, ttlMs, loader, { staleMs }):
 *   - inside ttlMs: the cached value.
 *   - between ttlMs and ttlMs + staleMs: the cached value, plus one background refresh.
 *   - otherwise: waits for the loader.
 * Concurrent callers of the same key share one in-flight load. A failed load is
 * never stored; the last good value is returned instead when there is one.
 *
 * Keys are global: per-client data must include the client id in its key.
 */
const { AsyncResource } = require('async_hooks');

const entries = new Map();
const SWEEP_MS = 10 * 60 * 1000;

// Background refreshes run outside the triggering request's async context, so
// they are not counted in that request's WHMCS timings.
const detached = new AsyncResource('cache-refresh');

function load(key, entry, loader) {
  if (entry.inflight) return entry.inflight;
  entry.inflight = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (entries.get(key) === entry) {
        entry.value = value;
        entry.has = true;
        entry.at = Date.now();
      }
      return value;
    })
    .finally(() => { entry.inflight = null; });
  return entry.inflight;
}

function cached(key, ttlMs, loader, { staleMs = 0 } = {}) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { has: false, value: undefined, at: 0, keepMs: 0, inflight: null };
    entries.set(key, entry);
  }
  entry.keepMs = Math.max(entry.keepMs, ttlMs + staleMs);
  const age = Date.now() - entry.at;
  if (entry.has && age < ttlMs) return Promise.resolve(entry.value);
  if (entry.has && age < ttlMs + staleMs) {
    if (!entry.inflight) {
      detached.runInAsyncScope(() => load(key, entry, loader).catch((err) => {
        console.warn(`[cache] refresh failed for ${key}: ${err.message}`);
      }));
    }
    return Promise.resolve(entry.value);
  }
  return load(key, entry, loader).catch((err) => {
    if (entry.has) return entry.value;
    throw err;
  });
}

/** Deletes `key`; a trailing `*` deletes every key with that prefix. */
function invalidate(keyOrPrefix) {
  const key = String(keyOrPrefix);
  if (key.endsWith('*')) {
    const prefix = key.slice(0, -1);
    for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
  } else {
    entries.delete(key);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of entries) {
    if (!e.inflight && (!e.has || now - e.at > e.keepMs)) entries.delete(k);
  }
}, SWEEP_MS).unref();

module.exports = { cached, invalidate };
