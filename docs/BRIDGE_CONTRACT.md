# SNBD Portal Bridge — contract

The portal (Node, `portal.bysnbdhost.top`) talks to WHMCS (`portal.snbdhost.com`) through one
WHMCS addon module, `snbd_portal_bridge`. Both sides implement exactly this contract.

## Transport

- `POST {BRIDGE_URL}` where `BRIDGE_URL` defaults to
  `https://portal.snbdhost.com/modules/addons/snbd_portal_bridge/bridge.php`.
- Body: JSON, max 64 KB. `Content-Type: application/json`.
- Headers:
  - `X-Bridge-Ts`: unix time in seconds.
  - `X-Bridge-Nonce`: 32 random hex chars, unique per request.
  - `X-Bridge-Sig`: lowercase hex `HMAC-SHA256(secret, ts + "." + nonce + "." + rawBody)`.
- The server rejects requests when the timestamp is more than 120 s from server time, when the
  nonce was seen in the last 10 minutes, or when the signature does not match (constant-time
  compare). These return HTTP 401 `{ "ok": false, "error": { "code": "auth", "message": "..." } }`.
- Optional addon setting `allowed_ips` (comma separated). When set, the client IP must match.
  The client IP is `CF-Connecting-IP` when present, otherwise `REMOTE_ADDR`.
- Success: HTTP 200 `{ "ok": true, "data": ... }`.
- Application error: HTTP 200 `{ "ok": false, "error": { "code": "<code>", "message": "<human text>" } }`.
  Codes: `bad_request`, `not_found` (also used for "not your service"), `not_active`,
  `not_allowed` (function not whitelisted), `confirm_required`, `module_error`, `internal`.
- Malformed JSON or unknown `op`: HTTP 400 with `bad_request`.

Every request body has `"op"` and, for client operations, `"clientId"` (int). The bridge never
trusts any other client identifier from the body.

## Operations

### `ping`
Request `{ "op": "ping" }` →
`{ "version": "1.0.0", "whmcs": "8.x.y", "modules": ["cpanel","snbd_n8n",...] }`
(`modules` = server modules that have at least one active service).

### `batch`
Runs several WHMCS internal API calls (`localAPI`) in one request, so a portal page costs one round trip.
Request:
```json
{ "op": "batch", "clientId": 12, "calls": [
  { "key": "client", "action": "GetClientsDetails", "params": { "stats": true } },
  { "key": "tickets", "action": "GetSupportTickets", "params": { "limitnum": 5 } }
] }
```
- At most 12 calls. `key` is any string; results are returned under it.
- The bridge forces the client scope: it overwrites `clientid` and `userid` with `clientId` for
  every action in the client-scoped list below, and rejects calls whose action is not whitelisted.
- Response data: `{ "client": { ...localAPI result... }, "tickets": { ... } }`. A failing call
  yields `{ "result": "error", "message": "..." }` under its key; other calls still run.

Whitelisted actions (client-scoped unless marked global):
`GetClientsDetails, GetClientsProducts, GetClientsDomains, GetClientsAddons, GetInvoices,
GetInvoice*, GetSupportTickets, GetSupportTicket*, GetTicketNotes*, GetQuotes, GetEmails,
GetContacts, GetTransactions, GetOrders, GetCredits, GetAnnouncements (global),
GetKBArticles (global), GetSupportDepartments (global), GetPaymentMethods (global),
GetCurrencies (global), GetProducts (global), GetTLDPricing (global), GetServers (global)`

`*` = object lookup: the bridge loads the record and returns `not_found` unless it belongs to
`clientId` (invoice `userid`, ticket `userid`).

### `dashboard`
Request `{ "op": "dashboard", "clientId": 12 }` → one call that returns
```json
{
  "client": { "id": 12, "firstname": "...", "lastname": "...", "fullname": "...", "email": "...",
              "currency": 1, "currency_code": "BDT", "credit": "0.00", "language": "" },
  "stats": { "numdueinvoices": 1, "dueinvoicesbalance": "1497.00", "numoverdueservices": 0,
             "numactiveservices": 2, "numactivedomains": 1, "numactivetickets": 1 },
  "services": [ /* latest 5, GetClientsProducts product objects */ ],
  "domains":  [ /* latest 5, GetClientsDomains domain objects */ ],
  "invoices": [ /* latest 5 by id desc, GetInvoices invoice objects incl. currencycode/currencyprefix */ ],
  "tickets":  [ /* up to 5 not Closed, GetSupportTickets ticket objects */ ]
}
```

### `service.view`
Request `{ "op": "service.view", "clientId": 12, "serviceId": 345 }`.
`not_found` unless `tblhosting.id = serviceId AND tblhosting.userid = clientId`.
Response:
```json
{
  "service": {
    "id": 345, "pid": 42, "name": "USA-01 Starter", "groupname": "USA Shared Hosting",
    "domain": "example.com", "status": "Active", "billingcycle": "Monthly",
    "recurringamount": "97.00", "nextduedate": "2026-12-01", "regdate": "2026-01-01",
    "username": "exampl", "dedicatedip": "", "assignedips": [],
    "server": { "name": "usa1", "hostname": "usa1.snbdhost.com", "ip": "1.2.3.4" },
    "nameservers": ["ns1.snbdhost.com", "ns2.snbdhost.com"],
    "diskusage": 120, "disklimit": 1024, "bwusage": 3000, "bwlimit": 51200,
    "lastupdate": "2026-11-09 03:00:00"
  },
  "module": "cpanel",
  "kind": "hosting",
  "actions": [ { "fn": "ClientRestart", "label": "Restart", "confirm": false, "danger": false } ],
  "sso": [ { "app": "", "label": "cPanel" }, { "app": "Email_Webmail", "label": "Webmail" } ],
  "panel": { /* normalised, see below */ },
  "raw": { "templatefile": "...", "vars": { /* ClientArea vars, secrets removed */ } }
}
```
- `kind` mapping: `cpanel` → `hosting`; `snbd_n8n`, `openclaw_n8n` → `n8n`; `hermesagent` → `hermes`;
  `ArkHostHetznerVPS`, `pvewhmcs`, `puqProxmoxKVM`, `snbdpanel` → `vps`; anything else → `generic`.
- `raw.vars` drops any key matching `/pass|secret|token|key|hash|jwt|private/i` at any depth,
  and anything that is not a scalar or array.
- Module errors while building the view do not fail the op: `panel` falls back to `{}`, and
  `raw.error` carries the message.
- `actions` only lists functions from the whitelist that the module actually defines.

`panel` shape per kind (missing values are `null`, never omitted):
- `hosting`: `{ "cpanelUrl": "https://host:2083", "webmailUrl": "https://host:2096" }`
- `n8n`: `{ "url": "https://x.n8n.snbdhost.com", "state": "running|stopped|deploying|suspended|error|unknown",
           "version": "1.x", "resources": { "cpu": "1", "ram": "1 GB", "disk": "10 GB" }, "database": "SQLite",
           "mode": "Standard|Queue", "workers": null }`
- `hermes`: `{ "state": "running|stopped|deploying|error|unknown", "endpoint": "https://...",
              "dashboardUrl": "https://...", "llm": { "used": 1234, "limit": 10000000, "unit": "tokens" },
              "brain": "model name" }`
- `vps`: `{ "state": "running|stopped|starting|stopping|deploying|suspended|unknown",
           "ipv4": ["1.2.3.4"], "ipv6": [], "os": "Ubuntu 24.04", "location": "Falkenstein",
           "specs": { "cpu": 2, "ramMb": 2048, "diskGb": 40 }, "hostname": "server1.example.com",
           "consoleAvailable": true,
           "graphs": [ { "name": "CPU %", "points": [[1731200000, 12.5]] } ] }`
- `generic`: `{}`

### `service.action`
Request `{ "op": "service.action", "clientId": 12, "serviceId": 345, "fn": "ClientRestart", "confirm": true, "args": {} }`.
- Ownership as in `service.view`. Service must be `Active`, otherwise `not_active`.
- `fn` must be in the module whitelist below, otherwise `not_allowed`. Functions starting with `Admin` are always rejected.
- Dangerous functions require `"confirm": true`, otherwise `confirm_required`.
- Response `{ "message": "Restarted", "data": { ... } }`; `data` may contain:
  - `url` (console/VNC link to open in a new window),
  - `password` (shown once to the user),
  - `logs` (plain text, max 200 lines),
  - `file` `{ "name": "backup.tar.gz", "url": "..." }` (a download link; never inline file contents).

Whitelist (`*` = needs `confirm`):
| Module | Functions |
|---|---|
| `openclaw_n8n` | `ClientStart`, `ClientStop*`, `ClientRestart`, `ClientReinstall*` |
| `snbd_n8n` | the client actions handled by `snbd_n8n_handleClientAjax` (destructive ones need confirm) |
| `hermesagent` | `restart`, `viewlogs`, `regenpassword`, `downloadbackup`, `healthcheck`, `redeploy*`, `killswitch*` |
| `ArkHostHetznerVPS` | `Start`, `Stop*`, `Reboot`, `VNC` |
| `pvewhmcs` | `vmStart`, `vmReboot`, `vmShutdown*`, `vmStop*`, `noVNC` |
| `puqProxmoxKVM` | the keys of its `ClientAreaCustomButtonArray()` / `ClientAreaAllowedFunctions()` at runtime |
| `snbdpanel` | `resetpassword` |
| `cpanel` | none (use `service.sso`) |

### `service.sso`
Request `{ "op": "service.sso", "clientId": 12, "serviceId": 345, "app": "Email_Accounts" }` →
`{ "url": "https://usa1.snbdhost.com:2083/cpsess.../?goto_app=..." }`.
- `cpanel`: WHMCS `ServiceSingleSignOn` with `app` (empty = cPanel home). Allowed `app` values:
  `"", "Email_Webmail", "Email_Accounts", "FileManager_Home", "Database_MySQL", "Database_phpMyAdmin",
  "Backups_Home", "SSL_TLS_Status", "Domains_Home", "WordPress_Manager"`.
- `snbdpanel`: its `sso` function.
- Other modules: `not_allowed`.

### `whmcs.sso`
Request `{ "op": "whmcs.sso", "clientId": 12, "path": "clientarea.php?action=productdetails&id=345" }` →
`{ "url": "https://portal.snbdhost.com/oauth/singlesignon.php?..." }` via `localAPI('CreateSsoToken')`.
`path` must start with `clientarea.php` or `viewinvoice.php`.

## Install / activation (WHMCS side)

- Files live in `modules/addons/snbd_portal_bridge/` of the WHMCS root.
- `snbd_portal_bridge_config()` exposes `shared_secret` (password) and `allowed_ips` (text).
- `activate()` creates table `mod_snbd_bridge_nonce (nonce CHAR(32) PRIMARY KEY, ts INT)`.
- CLI helper `install.php` (refuses to run unless `PHP_SAPI === 'cli'`) activates the addon and
  stores the secret read from the `BRIDGE_SECRET` environment variable, without printing it.

## Portal side config (`.env`)

- `BRIDGE_URL` (optional, default above), `BRIDGE_SECRET` (required to enable the bridge).
- When `BRIDGE_SECRET` is not set, or in mock mode, the portal uses `src/lib/mock-bridge.js` fixtures (mock) or its existing direct-API code paths (live).
