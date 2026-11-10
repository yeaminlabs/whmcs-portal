'use strict';

/**
 * UptimeRobot API v3 client and the Network status view model (docs/STATUS_CONTRACT.md).
 *
 * Monitor objects returned by the API contain credentials (httpPassword, apiKey,
 * customHttpHeaders, ...). Nothing from them reaches the view model except the
 * fields copied one by one in toPublicMonitor() / toPublicIncident(), and free
 * text is scrubbed of URLs, IPs and hostnames.
 *
 * Request budget: the free plan allows 10 requests/min. The monitor list and the
 * incident list (the "core" calls) may wait up to CORE_WAIT_MS for budget. Per-monitor
 * stats are cached for STATS_TTL_MS and only fetched when budget is free right now;
 * a monitor whose stats could not be fetched falls back to incident-derived uptime.
 */
const config = require('../config');
const { cached } = require('./cache');

const TIMEOUT_MS = 10_000;
const WINDOW_MS = 60_000;
const CORE_WAIT_MS = 10_000;
const DAY_MS = 86_400_000;
const BAR_DAYS = 30;
const MODEL_TTL_MS = 60_000;
const MODEL_STALE_MS = 15 * 60_000;
const STATS_TTL_MS = 10 * 60_000;
const STATS_STALE_MS = 50 * 60_000;
const MONITOR_PAGES = 20;
const INCIDENT_PAGES = 5;
const MAX_INCIDENTS = 10;
const REASON_MAX = 120;
const NAME_MAX = 80;

class UptimeRobotError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'UptimeRobotError';
    this.status = status;
  }
}

class BudgetError extends UptimeRobotError {
  constructor() {
    super('UptimeRobot rate-limit budget exhausted', 429);
    this.name = 'BudgetError';
  }
}

// ---------------------------------------------------------------------------
// Rate limiter: local sliding window plus the server's X-RateLimit-* headers.

const limiter = { limit: 10, sent: [], remaining: null, resetAt: 0, blockedUntil: 0 };
let requestCount = 0;

function freeSlots(now) {
  while (limiter.sent.length && now - limiter.sent[0] >= WINDOW_MS) limiter.sent.shift();
  if (now < limiter.blockedUntil) return 0;
  let n = limiter.limit - limiter.sent.length;
  if (limiter.remaining != null && now < limiter.resetAt) n = Math.min(n, limiter.remaining);
  return n;
}

function nextSlotAt(now) {
  let at = now;
  if (now < limiter.blockedUntil) at = Math.max(at, limiter.blockedUntil);
  if (limiter.remaining === 0 && now < limiter.resetAt) at = Math.max(at, limiter.resetAt);
  if (limiter.sent.length >= limiter.limit) at = Math.max(at, limiter.sent[0] + WINDOW_MS);
  return at;
}

async function acquire(maxWaitMs) {
  for (;;) {
    const now = Date.now();
    if (freeSlots(now) > 0) {
      limiter.sent.push(now);
      if (limiter.remaining != null && now < limiter.resetAt) limiter.remaining -= 1;
      return;
    }
    const wait = nextSlotAt(now) - now + 50;
    if (wait > maxWaitMs) throw new BudgetError();
    await new Promise((r) => setTimeout(r, wait));
    maxWaitMs -= wait;
  }
}

/** X-RateLimit-Reset is documented as epoch seconds but the live API sends seconds-until-reset; accept both. */
function readRateHeaders(res) {
  const now = Date.now();
  const limit = parseInt(res.headers.get('x-ratelimit-limit'), 10);
  const remaining = parseInt(res.headers.get('x-ratelimit-remaining'), 10);
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (limit > 0) limiter.limit = limit;
  if (Number.isFinite(remaining) && remaining >= 0) {
    limiter.remaining = remaining;
    limiter.resetAt = Number.isFinite(reset) && reset > 0
      ? (reset > 1e9 ? reset * 1000 : now + reset * 1000)
      : now + WINDOW_MS;
  }
}

function retryAfterMs(res) {
  const raw = res.headers.get('retry-after');
  if (raw == null || raw === '') return WINDOW_MS;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : WINDOW_MS;
}

// ---------------------------------------------------------------------------
// HTTP

/** Only paths under the configured base URL are requested, so a nextLink can never send the key elsewhere. */
function resolveUrl(pathOrUrl) {
  const base = new URL(config.uptimerobot.baseUrl);
  const url = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(base.href.replace(/\/+$/, '') + pathOrUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  if (url.origin !== base.origin || !(url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))) {
    throw new UptimeRobotError('UptimeRobot link outside the API base URL');
  }
  return url;
}

async function request(pathOrUrl, { maxWaitMs = 0 } = {}) {
  if (!config.uptimerobot.apiKey) throw new UptimeRobotError('UptimeRobot API key not configured');
  const url = resolveUrl(pathOrUrl);
  const label = `GET ${url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id')}`;
  for (let attempt = 1; ; attempt++) {
    await acquire(maxWaitMs);
    requestCount += 1;
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.uptimerobot.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const why = err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timed out' : 'network error';
      throw new UptimeRobotError(`UptimeRobot ${label} ${why}`);
    }
    readRateHeaders(res);
    if (res.status === 429) {
      const wait = retryAfterMs(res);
      limiter.blockedUntil = Date.now() + wait;
      if (attempt === 1 && wait <= maxWaitMs) continue;
      throw new UptimeRobotError(`UptimeRobot ${label} rate limited`, 429);
    }
    if (!res.ok) throw new UptimeRobotError(`UptimeRobot ${label} HTTP ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new UptimeRobotError(`UptimeRobot ${label} returned invalid JSON`, res.status);
    }
  }
}

async function listAll(path, { maxPages, maxWaitMs }) {
  const items = [];
  let next = path;
  for (let page = 0; next && page < maxPages; page++) {
    const body = await request(next, { maxWaitMs });
    if (!body || !Array.isArray(body.data)) throw new UptimeRobotError('UptimeRobot returned an unexpected list');
    items.push(...body.data);
    next = typeof body.nextLink === 'string' && body.nextLink ? body.nextLink : null;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Sanitising helpers

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g;
const IPV6_RE = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
const HOST_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}\b/gi;
const HIDDEN = '[hidden]';

function redactHosts(text) {
  return text
    .replace(URL_RE, HIDDEN)
    .replace(IPV4_RE, HIDDEN)
    .replace(IPV6_RE, (m) => (m.includes('::') || m.split(':').length >= 4 ? HIDDEN : m))
    .replace(HOST_RE, HIDDEN);
}

function cleanText(value, max) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return redactHosts(text).slice(0, max).trim();
}

function toMs(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function iso(ms) {
  return ms == null ? null : new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function round2(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;
}

function intOrNull(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

// ---------------------------------------------------------------------------
// Mapping

const STATUS_MAP = { UP: 'up', DOWN: 'down', PAUSED: 'paused', NOT_CHECKED_YET: 'pending', STARTED: 'pending' };
const KIND_MAP = { PING: 'server', HTTP: 'website', KEYWORD: 'website' };
const KIND_LABEL = { server: 'Server', website: 'Website', service: 'Service' };
const REGION_LABEL = { na: 'North America', eu: 'Europe', as: 'Asia', oc: 'Oceania', sa: 'South America', af: 'Africa' };

function mapStatus(status) {
  return STATUS_MAP[String(status || '').toUpperCase()] || 'unknown';
}

function mapKind(type) {
  return KIND_MAP[String(type || '').toUpperCase()] || 'service';
}

function regionLabel(regionalData) {
  const list = regionalData && Array.isArray(regionalData.REGION) ? regionalData.REGION : [];
  const code = String(list[0] || '').trim().toLowerCase();
  if (!code) return null;
  return REGION_LABEL[code] || code.replace(/[^a-z0-9_-]/g, '').slice(0, 16).toUpperCase() || null;
}

function monitorName(raw, kind) {
  const name = cleanText(raw.friendlyName, NAME_MAX);
  return name && name.replace(/\[hidden\]/g, '').replace(/[\s\-_.:,/|()]+/g, '') ? name : KIND_LABEL[kind];
}

function isDowntime(incident) {
  return !incident.type || /^downtime$/i.test(String(incident.type));
}

function isResolved(incident) {
  return incident.resolvedAt != null || /resolved/i.test(String(incident.status || ''));
}

/** [startMs, endMs] for an incident; ongoing incidents end at `now`. */
function incidentSpan(incident, now) {
  const start = toMs(incident.startedAt);
  if (start == null) return null;
  let end = now;
  if (isResolved(incident)) {
    const resolvedAt = toMs(incident.resolvedAt);
    const duration = Number(incident.duration);
    if (resolvedAt != null) end = resolvedAt;
    else if (Number.isFinite(duration) && duration >= 0) end = start + duration * 1000;
  }
  end = Math.min(end, now);
  return end > start ? [start, end] : null;
}

function mergeSpans(spans) {
  const sorted = spans.filter(Boolean).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function downtimeMs(spans, from, to) {
  let total = 0;
  for (const [s, e] of spans) total += Math.max(0, Math.min(e, to) - Math.max(s, from));
  return total;
}

function uptimeBetween(spans, from, to) {
  if (!(to > from)) return null;
  return round2(100 * (1 - downtimeMs(spans, from, to) / (to - from)));
}

/** Monitor lifetime used for uptime: from createDateTime until now, or until it was paused. */
function lifetime(raw, status, now) {
  const created = toMs(raw.createDateTime);
  const stateSec = Number(raw.currentStateDuration);
  const pausedAt = status === 'paused' && Number.isFinite(stateSec) && stateSec >= 0 ? now - stateSec * 1000 : null;
  return { start: created == null ? -Infinity : created, end: pausedAt == null ? now : Math.min(now, pausedAt) };
}

/**
 * BAR_DAYS UTC days, oldest first, ending today. uptime = 100 × (1 − downtime / observed seconds);
 * a full day observes 86400 s; days outside the lifetime are null.
 */
function computeBars(spans, life, now) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const bars = [];
  for (let i = BAR_DAYS - 1; i >= 0; i--) {
    const dayStart = today - i * DAY_MS;
    const from = Math.max(dayStart, life.start);
    const to = Math.min(dayStart + DAY_MS, life.end);
    bars.push({ date: iso(dayStart).slice(0, 10), uptime: uptimeBetween(spans, from, to) });
  }
  return bars;
}

function windowUptime(spans, life, days, now) {
  return uptimeBetween(spans, Math.max(now - days * DAY_MS, life.start), life.end);
}

function publicLastIncident(li, now) {
  if (!li || typeof li !== 'object') return null;
  const span = incidentSpan(li, now);
  if (!span) return null;
  const duration = Number(li.duration);
  return {
    startedAt: iso(span[0]),
    durationSec: isResolved(li) && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : Math.round((span[1] - span[0]) / 1000),
    reason: cleanText(li.reason, REASON_MAX) || null,
  };
}

/** Builds the public monitor field by field. `spans` are merged downtime spans; `stats` holds API-provided d30/responseMs. */
function toPublicMonitor(raw, { now = Date.now(), spans = [], stats = {} } = {}) {
  const id = Number(raw && raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const kind = mapKind(raw.type);
  const status = mapStatus(raw.status);
  const stateSec = Number(raw.currentStateDuration);
  const interval = Number(raw.interval);
  const life = lifetime(raw, status, now);
  const d30 = stats.d30 != null ? round2(stats.d30) : windowUptime(spans, life, 30, now);
  const rt = stats.responseMs;
  return {
    id,
    name: monitorName(raw, kind),
    kind,
    status,
    since: Number.isFinite(stateSec) && stateSec >= 0 ? iso(now - Math.round(stateSec) * 1000) : null,
    checkEverySec: Number.isFinite(interval) && interval > 0 ? Math.round(interval) : null,
    region: regionLabel(raw.regionalData),
    uptime: {
      d1: windowUptime(spans, life, 1, now),
      d7: windowUptime(spans, life, 7, now),
      d30,
    },
    responseMs: rt && rt.avg != null ? { avg: rt.avg, min: rt.min, max: rt.max } : null,
    bars: computeBars(spans, life, now),
    lastIncident: publicLastIncident(raw.lastIncident, now),
  };
}

function toPublicIncident(inc, { now = Date.now(), names = new Map() } = {}) {
  const span = incidentSpan(inc, now);
  if (!span) return null;
  const ongoing = !isResolved(inc);
  const monitorId = Number(inc.monitor && inc.monitor.id);
  const duration = Number(inc.duration);
  const resolvedAt = ongoing ? null : iso(toMs(inc.resolvedAt) != null ? toMs(inc.resolvedAt) : span[1]);
  return {
    id: cleanText(inc.id, 40).replace(/[^A-Za-z0-9_-]/g, ''),
    monitorName: names.get(monitorId) || cleanText(inc.monitor && inc.monitor.friendlyName, NAME_MAX).replace(/^\[hidden\]$/, '') || 'Monitor',
    status: ongoing ? 'ongoing' : 'resolved',
    startedAt: iso(span[0]),
    resolvedAt,
    durationSec: !ongoing && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : Math.round((span[1] - span[0]) / 1000),
    reason: cleanText(inc.reason, REASON_MAX) || null,
  };
}

function overallStatus(counts) {
  if (!counts.total) return 'unknown';
  const active = counts.total - counts.paused;
  if (active <= 0) return 'maintenance';
  if (counts.down > active / 2) return 'outage';
  if (counts.down > 0) return 'degraded';
  if (counts.up === 0) return 'unknown';
  return 'operational';
}

function emptyModel(configured) {
  return {
    configured,
    stale: false,
    updatedAt: null,
    overall: 'unknown',
    counts: { up: 0, down: 0, paused: 0, total: 0 },
    uptime30: null,
    monitors: [],
    incidents: [],
  };
}

/**
 * Pure view-model builder. `monitors` and `incidents` are raw API items;
 * `stats` maps monitor id → { d30, responseMs } from the stats endpoints.
 */
function buildModel({ monitors = [], incidents = [], stats = new Map(), now = Date.now() }) {
  const downtime = incidents.filter((i) => i && isDowntime(i));
  const spansById = new Map();
  const seen = new Set();
  for (const inc of downtime) {
    const id = Number(inc.monitor && inc.monitor.id);
    if (!spansById.has(id)) spansById.set(id, []);
    spansById.get(id).push(incidentSpan(inc, now));
    seen.add(String(inc.id));
  }
  // A monitor that is down right now may be in an incident older than the fetched window.
  for (const raw of monitors) {
    const li = raw && raw.lastIncident;
    if (!li || seen.has(String(li.id)) || isResolved(li) || mapStatus(raw.status) !== 'down') continue;
    const id = Number(raw.id);
    if (!spansById.has(id)) spansById.set(id, []);
    spansById.get(id).push(incidentSpan(li, now));
  }

  const publicMonitors = [];
  for (const raw of monitors) {
    if (!raw || typeof raw !== 'object') continue;
    const id = Number(raw.id);
    const m = toPublicMonitor(raw, { now, spans: mergeSpans(spansById.get(id) || []), stats: stats.get(id) || {} });
    if (m) publicMonitors.push(m);
  }

  const counts = { up: 0, down: 0, paused: 0, total: publicMonitors.length };
  for (const m of publicMonitors) if (m.status in counts) counts[m.status] += 1;

  const d30s = publicMonitors.filter((m) => m.status !== 'paused' && m.uptime.d30 != null).map((m) => m.uptime.d30);
  const uptime30 = d30s.length ? round2(d30s.reduce((a, b) => a + b, 0) / d30s.length) : null;

  const names = new Map(publicMonitors.map((m) => [m.id, m.name]));
  const since = now - 30 * DAY_MS;
  const publicIncidents = downtime
    .map((inc) => toPublicIncident(inc, { now, names }))
    .filter((i) => i && (i.status === 'ongoing' || toMs(i.startedAt) >= since))
    .sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt))
    .slice(0, MAX_INCIDENTS);

  return {
    configured: true,
    stale: false,
    updatedAt: iso(now),
    overall: overallStatus(counts),
    counts,
    uptime30,
    monitors: publicMonitors,
    incidents: publicIncidents,
  };
}

// ---------------------------------------------------------------------------
// Loading

function logFailure(what, err) {
  if (err instanceof BudgetError) return;
  console.warn(`[UptimeRobot] ${what}: ${err && err.message ? err.message : 'failed'}`);
}

function uptime30Stat(id) {
  return cached(`uptime:stats:uptime30:${id}`, STATS_TTL_MS, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * DAY_MS);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const body = await request(`/monitors/${id}/stats/uptime?${qs}`);
    return { d30: round2(body && body.uptime) };
  }, { staleMs: STATS_STALE_MS }).catch((err) => { logFailure(`uptime stats for monitor ${id}`, err); return null; });
}

function responseTimeStat(id) {
  return cached(`uptime:stats:rt:${id}`, STATS_TTL_MS, async () => {
    const body = await request(`/monitors/${id}/stats/response-time`);
    const s = (body && body.summary) || {};
    const avg = intOrNull(s.avg);
    return { responseMs: avg == null ? null : { avg, min: intOrNull(s.min), max: intOrNull(s.max) } };
  }, { staleMs: STATS_STALE_MS }).catch((err) => { logFailure(`response-time stats for monitor ${id}`, err); return null; });
}

async function loadStats(monitors) {
  const stats = new Map();
  const active = monitors.filter((m) => {
    const s = mapStatus(m.status);
    return Number.isSafeInteger(Number(m.id)) && (s === 'up' || s === 'down');
  });
  await Promise.all(active.map(async (m) => {
    const id = Number(m.id);
    const wantRt = String(m.type || '').toUpperCase() !== 'HEARTBEAT';
    const [u, r] = await Promise.all([uptime30Stat(id), wantRt ? responseTimeStat(id) : null]);
    stats.set(id, { d30: u ? u.d30 : null, responseMs: r ? r.responseMs : null });
  }));
  return stats;
}

const health = { okAt: 0, failAt: 0 };

async function loadModel() {
  try {
    const now = Date.now();
    const oldestBar = Math.floor(now / DAY_MS) * DAY_MS - (BAR_DAYS - 1) * DAY_MS;
    const incidentsSince = new Date(oldestBar - 7 * DAY_MS).toISOString();
    const [monitors, incidents] = await Promise.all([
      listAll('/monitors?limit=50', { maxPages: MONITOR_PAGES, maxWaitMs: CORE_WAIT_MS }),
      listAll(`/incidents?${new URLSearchParams({ limit: '200', started_after: incidentsSince })}`, { maxPages: INCIDENT_PAGES, maxWaitMs: CORE_WAIT_MS }),
    ]);
    const stats = await loadStats(monitors);
    const model = buildModel({ monitors, incidents, stats, now: Date.now() });
    health.okAt = Date.now();
    return model;
  } catch (err) {
    health.failAt = Date.now();
    logFailure('status refresh failed', err);
    throw err;
  }
}

/** The Network status view model. Never throws. */
async function getStatus() {
  if (!config.uptimerobot.enabled) return emptyModel(false);
  try {
    const model = await cached('uptime:status', MODEL_TTL_MS, loadModel, { staleMs: MODEL_STALE_MS });
    return { ...model, stale: health.failAt > health.okAt };
  } catch {
    return emptyModel(true);
  }
}

module.exports = {
  getStatus,
  buildModel,
  toPublicMonitor,
  toPublicIncident,
  overallStatus,
  emptyModel,
  mapStatus,
  mapKind,
  regionLabel,
  computeBars,
  cleanText,
  apiStats: () => ({ requests: requestCount, limit: limiter.limit, remaining: limiter.remaining }),
  _internals: { limiter, health, request, listAll, resolveUrl },
};
