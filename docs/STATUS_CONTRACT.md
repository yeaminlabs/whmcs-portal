# Network status — data contract

The Network status page (`GET /status`, logged-in clients) shows live monitoring from
UptimeRobot API v3 (https://uptimerobot.com/api/v3/). The backend builds one sanitised
view model; the view renders only that model. `GET /status.json` returns the same model for
in-page refresh.

## Source API (verified against the live account)

- Base `https://api.uptimerobot.com/v3`, header `Authorization: Bearer <UPTIMEROBOT_API_KEY>`.
- `GET /monitors?limit=50`: `{ data: [monitor], nextLink: string|null }`. Follow `nextLink` (full URL) until null.
  Monitor fields used: `id`, `friendlyName`, `status` (`UP`, `DOWN`, `PAUSED`, ...), `type` (`PING`, `HTTP`, `KEYWORD`, `PORT`, `HEARTBEAT`, ...),
  `interval` (s), `currentStateDuration` (s), `lastIncident` `{ id, status, cause, reason, startedAt, duration }`,
  `regionalData` `{ REGION: [string], INFRASTRUCTURE: string }`, `createDateTime`.
- `GET /monitors/{id}/stats/uptime` → `{ uptime, total_downtime_seconds, incident_count, from, to }`.
- `GET /monitors/{id}/stats/response-time` → `{ summary: { min, max, avg }, data_points, from, to }`.
- `GET /incidents?limit=N` → `{ data: [{ id, status, type, cause, reason, monitor: {...}, startedAt, resolvedAt, duration }], nextLink }`.
- Time-range query parameters for the stats endpoints must be confirmed from the docs (and by a live call) before use.

**Never expose** `url`, `httpUsername`, `httpPassword`, `customHttpHeaders`, `apiKey`, `heartbeatUrl`, `postValueData`,
`keywordValue`, `port`, `assignedAlertContacts`, `userId`, `maintenanceWindows`, or any IP/hostname. Monitor objects contain
credentials. Build the view model from an allow-list; never spread raw API objects into it.

## View model (`status`)

```js
{
  configured: true,                 // false when UPTIMEROBOT_API_KEY is not set (view shows a neutral notice)
  stale: false,                     // true when served from cache after a failed refresh
  updatedAt: '2026-11-10T08:30:00Z',
  overall: 'operational',           // 'operational' | 'degraded' (some down) | 'outage' (all/most down) | 'maintenance' (all paused) | 'unknown'
  counts: { up: 4, down: 0, paused: 0, total: 4 },
  uptime30: 99.97,                  // average 30-day uptime across non-paused monitors, 2 decimals, or null
  monitors: [{
    id: 801207964,                  // number
    name: 'USA Server',             // trimmed friendlyName
    kind: 'server',                 // PING → 'server'; HTTP/KEYWORD → 'website'; PORT/HEARTBEAT/other → 'service'
    status: 'up',                   // 'up' | 'down' | 'paused' | 'pending' | 'unknown'
    since: '2026-11-01T10:00:00Z',  // now - currentStateDuration, or null
    checkEverySec: 300,
    region: 'North America',        // human label from regionalData.REGION[0], or null
    uptime: { d1: 100, d7: 99.98, d30: 99.95 },   // percentages (2 decimals) or null when unavailable
    responseMs: { avg: 182, min: 120, max: 410 }, // last 24 h, integers, or null
    bars: [ { date: '2026-10-12', uptime: 100 }, ... ],  // 30 entries, oldest → newest; uptime null = no data
    lastIncident: { startedAt: '...', durationSec: 340, reason: 'Connection Timeout' } // or null
  }],
  incidents: [{                     // newest first, max 10, last 30 days
    id: '123',
    monitorName: 'USA Server',
    status: 'resolved',             // 'ongoing' | 'resolved'
    startedAt: '...', resolvedAt: '...' /* or null */, durationSec: 340,
    reason: 'Connection Timeout'    // plain text, max 120 chars
  }]
}
```

- `bars` are computed from the incident list: per calendar day (UTC), uptime = 100 × (1 − downtime seconds that day / 86400),
  clipped to the monitor's lifetime (days before `createDateTime` → `null`). This keeps API calls low.
- Status mapping: `UP` → up; `DOWN` → down; `PAUSED` → paused; `NOT_CHECKED_YET`/`STARTED` → pending; else unknown.
- Region label mapping: `na` North America, `eu` Europe, `as` Asia, `oc` Oceania, `sa` South America, `af` Africa, else the raw code uppercased.

## Caching and limits

- Cache the whole view model with `cached('uptime:status', 60_000, loader, { staleMs: 15 * 60_000 })` from `src/lib/cache.js`.
- Respect UptimeRobot rate limits: read `X-RateLimit-*` / `Retry-After` headers; never fire more than the plan allows
  (assume 10 requests/min on the free plan unless headers say otherwise). Per-monitor stats can refresh less often
  (their own cache, e.g. 10 min) than the monitor list (60 s).
- On API failure, serve the last good model with `stale: true`; with no good model, `configured: true, overall: 'unknown', monitors: []`.

## Config

- `.env`: `UPTIMEROBOT_API_KEY` (never committed, never logged, never sent to the browser).
- Mock mode (`MOCK_MODE=true`): fixtures from `src/lib/mock-uptime.js` covering up, down, paused and a recent incident.
