'use strict';

/**
 * Network status fixtures for MOCK_MODE: five monitors (servers, a website and a
 * service; up, down and paused), one ongoing and two resolved incidents, and 30
 * daily bars per monitor with a few dips. Same shape as uptimerobot.getStatus().
 */
const { overallStatus } = require('./uptimerobot');

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const round2 = (n) => Math.round(n * 100) / 100;

/** dips: { daysAgo: uptime }. Days on or after `pausedDaysAgo` have no data. */
function bars(today, dips = {}, pausedDaysAgo = null) {
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const uptime = pausedDaysAgo != null && i <= pausedDaysAgo ? null : (dips[i] != null ? dips[i] : 100);
    out.push({ date: iso(today - i * DAY_MS).slice(0, 10), uptime });
  }
  return out;
}

const avg = (list) => {
  const vals = list.filter((v) => v != null);
  return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
};

function buildMockStatus(now = Date.now()) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const outageStart = now - 42 * MIN_MS;
  const resolvedA = now - 3 * DAY_MS - 5 * 60 * MIN_MS;
  const resolvedB = now - 11 * DAY_MS - 2 * 60 * MIN_MS;

  const monitors = [
    {
      id: 900000001, name: 'USA Server', kind: 'server', status: 'up',
      since: iso(now - 9 * DAY_MS), checkEverySec: 300, region: 'North America',
      responseMs: { avg: 182, min: 120, max: 410 },
      bars: bars(today, { 11: 99.31, 23: 99.65 }),
      lastIncident: { startedAt: iso(resolvedB), durationSec: 600, reason: 'Connection Timeout' },
    },
    {
      id: 900000002, name: 'Europe Server', kind: 'server', status: 'up',
      since: iso(now - 21 * DAY_MS), checkEverySec: 300, region: 'Europe',
      responseMs: { avg: 96, min: 71, max: 233 },
      bars: bars(today, { 21: 99.79, 27: 98.96 }),
      lastIncident: { startedAt: iso(now - 21 * DAY_MS - 30 * MIN_MS), durationSec: 180, reason: 'No Response' },
    },
    {
      id: 900000003, name: 'Singapore Server', kind: 'server', status: 'down',
      since: iso(outageStart), checkEverySec: 60, region: 'Asia',
      responseMs: { avg: 264, min: 201, max: 1890 },
      bars: bars(today, { 0: round2(100 * (1 - 42 / (24 * 60))), 6: 97.92, 17: 99.86 }),
      lastIncident: { startedAt: iso(outageStart), durationSec: 42 * 60, reason: 'No Response' },
    },
    {
      id: 900000004, name: 'SNBD HOST Website', kind: 'website', status: 'up',
      since: iso(resolvedA + 25 * MIN_MS), checkEverySec: 300, region: 'North America',
      responseMs: { avg: 69, min: 37, max: 3348 },
      bars: bars(today, { 3: 98.26, 14: 99.65 }),
      lastIncident: { startedAt: iso(resolvedA), durationSec: 1500, reason: '502 Bad Gateway' },
    },
    {
      id: 900000005, name: 'Mail Service', kind: 'service', status: 'paused',
      since: iso(now - 2 * DAY_MS - 4 * 60 * MIN_MS), checkEverySec: 300, region: 'Europe',
      responseMs: null,
      bars: bars(today, { 9: 99.58 }, 2),
      lastIncident: null,
    },
  ].map((m) => {
    const days = m.bars.map((b) => b.uptime);
    return {
      ...m,
      uptime: { d1: m.status === 'paused' ? null : days[29], d7: avg(days.slice(-7)), d30: avg(days) },
    };
  });

  const counts = { up: 0, down: 0, paused: 0, total: monitors.length };
  for (const m of monitors) if (m.status in counts) counts[m.status] += 1;

  return {
    configured: true,
    stale: false,
    updatedAt: iso(now),
    overall: overallStatus(counts),
    counts,
    uptime30: avg(monitors.filter((m) => m.status !== 'paused').map((m) => m.uptime.d30)),
    monitors,
    incidents: [
      { id: 'mock-3', monitorName: 'Singapore Server', status: 'ongoing', startedAt: iso(outageStart), resolvedAt: null, durationSec: 42 * 60, reason: 'No Response' },
      { id: 'mock-2', monitorName: 'SNBD HOST Website', status: 'resolved', startedAt: iso(resolvedA), resolvedAt: iso(resolvedA + 25 * MIN_MS), durationSec: 1500, reason: '502 Bad Gateway' },
      { id: 'mock-1', monitorName: 'USA Server', status: 'resolved', startedAt: iso(resolvedB), resolvedAt: iso(resolvedB + 10 * MIN_MS), durationSec: 600, reason: 'Connection Timeout' },
    ],
  };
}

module.exports = { buildMockStatus };
