# Plan: Fast WHMCS calls + per-product service dashboards

## Goal
Make every portal page load in under 1 s (today the dashboard takes 8+ s), and give each purchased product its own management page in the portal: a cPanel dashboard for shared hosting, and native panels for n8n, OpenClaw, Hermes and VPS products. These pages are driven by the WHMCS server modules already installed, without sending customers to portal.snbdhost.com.

### Measured today (from the portal code against live WHMCS)
| Call | Time |
|---|---|
| Any single API call (GetCurrencies, GetInvoices…) | 590–750 ms, and the 2nd call is not faster |
| GetProducts (~170 KB) | 1.5 s |
| 5 calls in parallel | 0.8 s |
| A call blocked by the API role (GetSupportTickets) | **8.1 s**: 3 retries with 2 s + 4 s backoff |

Root causes:
1. `src/lib/whmcs.js` retries every failure, including HTTP 403 and `result:error`, so blocked actions cost ~8 s. The dashboard and tickets pages call GetSupportTickets, which is blocked.
2. It creates a new `https.Agent` per call, so every call pays a fresh TLS handshake through Cloudflare (~150 ms).
3. Each API request boots the whole WHMCS app (~400 ms server time). WHMCS's own PHP pages pay this once per page, while the portal pays it per API call (3–6 calls per page).
4. Route: vps-1 (AWS) → Cloudflare → WHMCS origin "snbdhost" (5.75.180.184). Each call crosses the internet twice.

### Modules found on the WHMCS server (modules/servers)
| Product groups | Module | Source | Client functions to expose |
|---|---|---|---|
| usa/bdix shared, reseller | `cpanel` (WHMCS core) | ionCube | `ServiceSingleSignOn` (with `app`), usage fields already in GetClientsProducts |
| n8n | `snbd_n8n` (own) | plain PHP | `ClientArea` vars + `handleClientAjax` actions |
| openclaw-hosting | `openclaw_n8n` (own) | plain PHP | `ClientStart`, `ClientStop`, `ClientRestart`, `ClientReinstall`, `ClientArea` vars, `handleAjax` actions |
| managed-ai-hosting | `hermesagent` (own) | plain PHP | `restart`, `viewlogs`, `regenpassword`, `downloadbackup`, `killswitch`, `redeploy`, `healthcheck`, `ClientArea` vars |
| usa/sg/eu/de vps, ai-agent-hosting | `ArkHostHetznerVPS` | plain PHP | `Start`, `Stop`, `Reboot`, `VNC`, `ClientAreaAPI` |
| bdix-vps | `pvewhmcs` | plain PHP | `vmStart`, `vmReboot`, `vmShutdown`, `vmStop`, `noVNC`, `ClientArea` vars |
| bdix-vps | `puqProxmoxKVM` | ionCube | functions listed in its `ClientAreaCustomButtonArray` / `ClientAreaAllowedFunctions` at runtime |
| panel-vps, bdix-vps | `snbdpanel` (own) | plain PHP | `sso`, `resetpassword`, `ClientArea` vars |

Module client pages cannot be embedded: they are Smarty templates whose JavaScript calls WHMCS (`clientarea.php?action=productdetails&modop=custom…`) with the WHMCS session cookie. That cookie is third-party inside an iframe on portal.bysnbdhost.top, and browsers block it. The portal therefore renders its own page per module and runs module functions through a signed bridge inside WHMCS.

## Steps

### Phase 1: Speed fixes inside the portal (no infrastructure change)

- [ ] 1. `src/lib/whmcs.js` — stop wasted retries and reuse connections.
  - Create one module-level `https.Agent({ keepAlive: true, maxSockets: 16, family: 4 })` and pass it to every axios call; delete the per-call `new https.Agent(...)`.
  - Retry only on network errors and HTTP 5xx, at most 2 attempts with a 300 ms backoff. Never retry HTTP 4xx or a JSON body with `result: "error"`.
  - Lower the axios `timeout` from 30000 to 15000 ms.
  - On HTTP 403, record the action in a `blocked` Map with a 10-minute expiry. While an action is blocked, `call()` returns `{ result: 'error', message: 'API action not permitted', blocked: true }` immediately without a request.
  - Log one line per blocked action per 10 minutes: `[WHMCS] <action> is not allowed by the API role`.
  - Edge cases: keep mock mode untouched. Keep secret scrubbing. A 403 caused by the IP allowlist will mark every action blocked for 10 minutes; `/health` must bypass the blocked map so it always reports the truth.

- [ ] 2. `src/lib/cache.js` (new) — shared cache helper.
  - `cached(key, ttlMs, loader, { staleMs })`: returns a fresh value inside the TTL. Between TTL and TTL+staleMs it returns the stale value and refreshes once in the background. Concurrent callers of the same key share one in-flight promise. Failed loads are not cached; the last good value is served if present.
  - Edge cases: never cache values derived from a specific client under a global key; always include the client id in the key for per-client data.

- [ ] 3. Use the cache for global data.
  - `src/lib/currency.js` `listCurrencies`: TTL 10 min, stale 1 h.
  - `src/lib/catalog.js` `loadProducts`: TTL 5 min, stale 1 h. `visibleSlugs`: TTL 10 min, stale 1 h. `getTldPrices`: TTL 30 min, stale 6 h.
  - `src/routes/portal.js` and `src/routes/store.js`: wrap `GetPaymentMethods` (10 min), `GetSupportDepartments` (1 h), `GetAnnouncements` (10 min), `GetKBArticles` (10 min), `GetDownloads` (1 h) and `GetServers` (1 min) with `cached()`.
  - Add `src/lib/warmup.js`, called from `src/server.js` after `listen`. It preloads currencies, products, store visibility for the 7 store groups, TLD pricing for every currency id, and payment methods. Errors are logged, never thrown.

- [ ] 4. `src/lib/client.js` (new) — one GetClientsDetails per request.
  - `getClient(req)` memoises `GetClientsDetails({ clientid, stats: true })` on `req` for the life of the request, and also in `cached('client:'+id, 10s)`.
  - Replace every direct GetClientsDetails call with `getClient(req)`: `currency.accountCurrency`, `clientCredit` in portal.js, the dashboard route, the profile GET route, and `store.js` `currencies()`.
  - Edge cases: after `/profile` POST, `/prefs` currency switch, `ApplyCredit`, `AddInvoicePayment` and `AddOrder`, call `invalidateClient(id)` to delete the cache key.

- [ ] 5. `src/routes/portal.js` — remove sequential waits and blocked calls.
  - Dashboard: start the ticket call only when tickets are allowed (`!whmcs.isBlocked('GetSupportTickets')`); otherwise pass `tickets: []` and set `ticketsUnavailable: true`, so the side panel says "Support tickets are temporarily unavailable" with a link to `/contact`.
  - Tickets list and detail pages: when `GetSupportTickets` / `GetSupportTicket` is blocked, render the same unavailable message instead of the error page.
  - Pay page (`renderPay`): fetch payment methods, client, `stripeAmount` and `bkashAmounts` in one `Promise.all`.
  - Service and domain detail pages: run the ownership check and the extra lookups (`siblingsOf`, `domainExtras`) in parallel, and discard the extras if ownership fails.

- [ ] 6. `src/server.js` — measurement.
  - Count WHMCS calls and their total time per request with `AsyncLocalStorage`, filled in by `whmcs.call`.
  - Send `Server-Timing: whmcs;dur=<ms>;desc="<n> calls", app;dur=<ms>` on every HTML response.
  - Log `[perf] GET /path 840ms (whmcs 3 calls 610ms)` for requests slower than 1500 ms.
  - Edge cases: no client data in logs, only paths without query strings.

### Phase 2: WHMCS bridge + move the portal next to WHMCS

- [ ] 7. WHMCS addon module `modules/addons/snbd_portal_bridge/` on the WHMCS server (`/home/snbdhost-portal/htdocs/portal.snbdhost.com`).
  - `snbd_portal_bridge.php`: addon metadata, plus `activate()`, which generates a 64-byte random `shared_secret` stored in the addon settings. Its admin output page shows the secret once, with a "rotate" button.
  - `bridge.php`: a single POST JSON endpoint. It bootstraps `init.php` and authenticates with headers `X-Bridge-Ts` (unix seconds; reject if more than 60 s off) and `X-Bridge-Sig` (hex HMAC-SHA256 of `ts + "." + rawBody` with the shared secret, compared in constant time). It accepts only requests from `127.0.0.1` (Phase 2 runs on the same host). The body is `{ "op": "...", "clientId": n, ... }`.
  - Operations:
    - `dashboard`: returns in one response the client, stats, last 5 services, domains, invoices and tickets (via `localAPI`), so the dashboard makes one call.
    - `service.view`: loads the service with `WHMCS\Module\Server::loadByServiceID`, checks `tblhosting.userid === clientId`, calls the module's `ClientArea`, and returns `{ module, templatefile, vars }` with any value whose key matches `/pass|secret|token|key|hash/i` removed.
    - `service.action`: runs a client function from the whitelist below through `$server->call(func)`, after the same ownership check, and returns `{ success, message, data }`.
    - `service.sso`: for `cpanel` it calls `ServiceSingleSignOn` with an optional `app` value (`Email_Accounts`, `FileManager_Home`, `Database_MySQL`, `Backups_Home`, `SSL_TLS_Status`, `Domains_Home`, `WordPress_Manager`, `phpMyAdmin`, or empty for the cPanel home); for `snbdpanel` it calls `sso`. Returns `{ url }`.
  - Whitelist, hard-coded in `bridge.php`:
    - `openclaw_n8n`: `ClientStart`, `ClientStop`, `ClientRestart`, `ClientReinstall`
    - `hermesagent`: `restart`, `viewlogs`, `regenpassword`, `downloadbackup`, `killswitch`, `redeploy`, `healthcheck`
    - `ArkHostHetznerVPS`: `Start`, `Stop`, `Reboot`, `VNC`, `ClientAreaAPI`
    - `pvewhmcs`: `vmStart`, `vmReboot`, `vmShutdown`, `vmStop`, `noVNC`
    - `puqProxmoxKVM`: the keys returned at runtime by its `ClientAreaCustomButtonArray` / `ClientAreaAllowedFunctions`
    - `snbd_n8n`: the action names handled inside `snbd_n8n_handleClientAjax` (read that function and copy its `case` list)
    - `snbdpanel`: `resetpassword`
    - Anything starting with `Admin` is always rejected.
  - Every request is logged to the WHMCS module log via `logModuleCall('snbd_portal_bridge', op, request, result)`.
  - Edge cases:
    - Suspended or terminated services return `{ success:false, message:'Service is not active' }` for actions.
    - `killswitch`, `ClientReinstall`, `vmStop` and `Stop` require `"confirm": true` in the body.
    - Module exceptions become `{ success:false, message }` with HTTP 200.
    - A request body over 64 KB is rejected.

- [ ] 8. Host the portal on the WHMCS server "snbdhost" (5.75.180.184) and retire vps-1 for the portal.
  - Requires a console token with deploy access; the current token is read-only.
  - Install to `/opt/whmcs-portal` with the same systemd unit, `whmcsportal` user and `.env`. Change `WHMCS_URL` to `http://127.0.0.1:8081` and add `WHMCS_HOST_HEADER=portal.snbdhost.com`.
  - Add an nginx server block `listen 127.0.0.1:8081` that serves the same WHMCS document root and PHP-FPM pool as portal.snbdhost.com. It allows only `/includes/api.php` and `/modules/addons/snbd_portal_bridge/bridge.php` and denies everything else.
  - Change the `portal.bysnbdhost.top` DNS A record to 5.75.180.184 and issue its certificate there with certbot.
  - Add 5.75.180.184 to the Stripe restricted key's IP allowlist; WHMCS already uses that IP.
  - Edge cases:
    - `src/lib/whmcs.js` must send `Host: portal.snbdhost.com` when `WHMCS_HOST_HEADER` is set, so WHMCS's System URL checks pass.
    - Keep vps-1 running until the new host passes Verification, then stop `whmcs-portal` on vps-1 and remove its nginx site.
    - The WHMCS API IP allowlist must include `127.0.0.1`.

- [ ] 9. `src/lib/bridge.js` (new) in the portal.
  - `bridge(op, body)` signs and posts to `${WHMCS_URL}/modules/addons/snbd_portal_bridge/bridge.php` with `BRIDGE_SECRET` from `.env`.
  - Timeout 15 s, no retries for `service.action`, and one retry on network error for read operations.
  - Mock mode returns fixtures from `src/lib/mock-bridge.js` (new): one fixture per module above.

- [ ] 10. `src/routes/portal.js` dashboard — switch to `bridge('dashboard')` when `BRIDGE_SECRET` is set, otherwise keep the Phase 1 calls.

### Phase 3: Product dashboards in the portal

- [ ] 11. `src/lib/service-kinds.js` (new) — map `service.module` (from `service.view`) to a dashboard: `cpanel` → `hosting`; `snbd_n8n` and `openclaw_n8n` → `n8n`; `hermesagent` → `hermes`; `ArkHostHetznerVPS`, `pvewhmcs`, `puqProxmoxKVM` and `snbdpanel` → `vps`; anything else → `generic`.

- [ ] 12. `src/routes/portal.js` `GET /services/:id`: after the ownership check, call `bridge('service.view')` and render `views/service/<kind>.ejs`. Add the action and sign-on routes below.
  - `POST /services/:id/action`: body `{ fn, confirm }`; the portal also checks `fn` against the whitelist for that module. Returns JSON for fetch calls, or redirects back with a flash message for normal form posts.
  - `POST /services/:id/sso`: body `{ app }`; responds `303` to the returned URL, which opens cPanel or snbdpanel directly in a new tab, not WHMCS.
  - Edge cases: when `service.view` fails, fall back to the current generic page (`views/service-detail.ejs`) with an alert "Live controls are temporarily unavailable".

- [ ] 13. `views/service/hosting.ejs` (new) — the cPanel dashboard.
  - Header with domain, status, plan and next due date.
  - Usage bars for disk and bandwidth from `diskusage/disklimit` and `bwusage/bwlimit` (WHMCS returns them in MB; show "Unlimited" when the limit is 0), with `lastupdate` as "Usage updated <date>".
  - Buttons "Log in to cPanel" and "Webmail" (`app` = `Email_Webmail`).
  - Shortcut grid posting `app` = Email accounts, File manager, Databases, phpMyAdmin, Backups, SSL/TLS, Domains, WordPress.
  - Account details: username, server hostname, shared IP, nameservers from `vars`.
  - Edge cases: hide the sign-on buttons when the status is not Active, with the text "Available once the service is active".

- [ ] 14. `views/service/n8n.ejs` (new) — instance URL (from `vars`; the key name is read from the `snbd_n8n` / `openclaw_n8n` ClientArea return value), status badge, plan resources, buttons Start/Stop/Restart (OpenClaw) or the `handleClientAjax` actions (snbd_n8n), and Reinstall behind a confirm dialog that requires typing the domain.

- [ ] 15. `views/service/hermes.ejs` (new).
  - Overview: status, endpoint, LLM usage from `vars`.
  - Buttons: Health check, Restart, Redeploy, Regenerate password (shows the new password once), Download backup (streams the returned file), View logs (last 200 lines in a `<pre>`), and Kill switch behind a typed confirmation.
  - The chat and terminal tabs stay on the WHMCS module page: a button "Open chat & terminal" calls `CreateSsoToken` with `sso_redirect_path=clientarea.php?action=productdetails&id=<id>` in a new tab. This is the only remaining WHMCS hand-off.

- [ ] 16. `views/service/vps.ejs` (new).
  - Status and power state, IPv4/IPv6, OS, location, CPU/RAM/disk from `vars` or `ClientAreaAPI`.
  - Power buttons (Start/Reboot/Stop; Stop needs confirmation), and Console, which opens the `VNC`/`noVNC` URL in a new window.
  - Graphs only when the module returns them (ArkHost `ClientAreaAPI`, pvewhmcs `fetch_rrd_stat`), drawn as inline SVG line charts; no chart library.
  - snbdpanel services get an "Open control panel" button via `service.sso`.

- [ ] 17. `views/service/generic.ejs` — the current `service-detail.ejs` content plus a "Manage" button using the same SSO hand-off as step 15, for modules not listed in step 11.

- [ ] 18. `src/i18n/en.js` and `src/i18n/bn.js` — add every new string from steps 5 and 12–17 in both languages; keep the key coverage check (every key used in views exists in both files) passing.

## Verification
- Phase 1, measured on the live host with the `Server-Timing` header from a logged-in browser session (`curl -b cookie -w '%{time_total}'`):
  - Dashboard: under 1.0 s (today 8+ s); a blocked action costs under 50 ms after the first time.
  - Store group page (warm): under 300 ms. Invoice pay page: under 900 ms.
  - Re-run `/tmp/snbd/full-test.js`, `cur-test.js` and `acct-test.js` in mock mode; all must pass.
- Phase 2:
  - From the WHMCS host, `curl` to `127.0.0.1:8081/includes/api.php` works, and the same request from outside fails.
  - A bridge request with a bad signature or stale timestamp returns 401.
  - `service.view` for another client's service returns 404.
  - Dashboard under 400 ms with one bridge call.
- Phase 3, with one real test service of each kind (shared hosting, n8n, OpenClaw, Hermes, ArkHost VPS, BDIX VPS):
  - The page renders without errors in English and Bangla.
  - cPanel and webmail sign-on open cPanel directly.
  - Restart/Reboot actions show success and appear in the WHMCS module log.
  - Actions on someone else's service return 404.
  - Suspended services show controls disabled.

## Out of scope
- Rebuilding Hermes chat and terminal inside the portal; they stay on the WHMCS page via SSO.
- Changing the WHMCS modules' own code or templates; the bridge calls them as they are.
- PayPal in-portal payments, WHMCS admin-side changes other than installing and activating the bridge addon, and the API-role permissions (enable `GetSupportTickets`, `GetSupportTicket`, `UpdateTicket` separately).
- Moving any other site off the WHMCS server, and putting portal.bysnbdhost.top behind the Cloudflare proxy.
