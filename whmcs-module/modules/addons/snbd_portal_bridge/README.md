# SNBD Portal Bridge (WHMCS addon)

`snbd_portal_bridge` lets the SNBD client portal (`portal.bysnbdhost.top`) read client data and run
whitelisted server-module functions for logged-in clients over one signed JSON endpoint, so customers
never have to visit the WHMCS site. The wire format is defined in `docs/BRIDGE_CONTRACT.md` of the
portal repository; this module implements it exactly.

Requirements: WHMCS 8.x, PHP 8.3 (ionCube loader as WHMCS needs it), outbound access from WHMCS to
the module back-ends as usual.

## Install

1. Upload this folder to `<whmcs>/modules/addons/snbd_portal_bridge/`
   (on the live server: `/home/snbdhost-portal/htdocs/portal.snbdhost.com/modules/addons/snbd_portal_bridge/`).
2. Activate, either:
   - **CLI (recommended)** — from the WHMCS root, as the site user:
     ```sh
     cd /home/snbdhost-portal/htdocs/portal.snbdhost.com
     BRIDGE_SECRET="$(openssl rand -hex 32)"   # keep it, the portal needs the same value
     BRIDGE_SECRET="$BRIDGE_SECRET" BRIDGE_ALLOWED_IPS="<portal server IP>" \
       php8.3 modules/addons/snbd_portal_bridge/install.php
     ```
     Prints `installed` (first run) or `updated`, plus non-secret details. Re-running is safe.
     `BRIDGE_ALLOWED_IPS` is optional; omit it to keep the current value.
   - **Admin area** — Setup > Addon Modules > SNBD Portal Bridge > Activate, then Configure: give admin
     roles access, paste a secret (≥ 32 chars) or use **Rotate secret** on the addon page.
3. Put the same secret in the portal `.env` as `BRIDGE_SECRET` (and `BRIDGE_URL` if not the default
   `https://portal.snbdhost.com/modules/addons/snbd_portal_bridge/bridge.php`).
4. Check: the addon page (Addons > SNBD Portal Bridge) shows the status and the last 20 calls; a portal
   `ping` returns the bridge version, WHMCS version and active server modules.

## Settings

| Setting | Meaning |
|---|---|
| `shared_secret` | HMAC-SHA256 key shared with the portal. At least 32 printable characters. Stored encrypted. |
| `allowed_ips` | Optional comma separated IPs / CIDR ranges. Checked against `CF-Connecting-IP` when present, else `REMOTE_ADDR`. Empty = signature only. |

## Security notes

- Every request must carry `X-Bridge-Ts` (±120 s), `X-Bridge-Nonce` (32 hex, single use for 10 min,
  stored in `mod_snbd_bridge_nonce`) and `X-Bridge-Sig` = `HMAC-SHA256(secret, ts.nonce.body)`,
  compared with `hash_equals`. Bodies over 64 KB are rejected before authentication.
- The bridge trusts only `clientId` from the body. Services must belong to that client; batch calls get
  `clientid`/`userid` overwritten and identity-switching params removed; invoice/ticket lookups are
  ownership-checked. Non-whitelisted batch actions reject the whole batch.
- Only the per-module whitelist can be called; `Admin*` functions never. Destructive functions need
  `"confirm": true`. Actions require the service to be `Active`.
- `raw.vars` drops keys matching `/pass|secret|token|key|hash|jwt|private/i` at any depth (plus
  `install_root`, `params`, `model`, cookies/sessions), objects, data URIs and strings over 4 KB.
- Each request is logged with `logModuleCall('snbd_portal_bridge', op, …)` with secrets, passwords,
  tokens and URLs masked, and summarised in `mod_snbd_bridge_log` (pruned after 30 days).
- Module code runs inside output buffers; if a module calls `exit`/`die`, a shutdown handler still answers
  JSON (`service.view` falls back to `panel: {}` with `raw.error`, actions return `module_error`).
- Backup downloads and the Hetzner VNC console are handed out as one-time links
  (`handoff.php?t=<128-bit token>`, 10 min / 2 min TTL, stored outside the web root in the system temp dir).
- `install.php` refuses to run outside the CLI and never prints the secret. Deactivating the addon drops
  the bridge tables and the endpoint rejects all requests.

## Operations

| op | Purpose |
|---|---|
| `ping` | Bridge version, WHMCS version, server modules with active services. |
| `batch` | Up to 12 whitelisted `localAPI` calls in one round trip, scoped to `clientId`. |
| `dashboard` | Client summary, stats and the latest services, domains, invoices and open tickets. |
| `service.view` | Service details, module kind, available actions, SSO apps, normalised `panel`, scrubbed `raw`. |
| `service.action` | Run a whitelisted module function (`confirm` for destructive ones). |
| `service.sso` | cPanel (`ServiceSingleSignOn` with an allowed `app`) or SNBD Panel sign-in URL. |
| `whmcs.sso` | `CreateSsoToken` link to a `clientarea.php` / `viewinvoice.php` path. |

### Action whitelist

| Module | Functions (`*` needs confirm) | How |
|---|---|---|
| `openclaw_n8n` | `ClientStart`, `ClientStop*`, `ClientRestart`, `ClientReinstall*` | module functions |
| `snbd_n8n` | `start`, `restart`, `stop*`, `upgrade*`, `get_disk`, `get_env`, `save_env*` (`args.env`), `change_password*` (`args.password`, `args.email`), `reset_users*`, `reset_data*`, `get_ws_token` (`args.endpoint`) | the module's `ContainerManager` / `EnvEditor` / `WsTokenManager` (its AJAX handler needs a browser CSRF session) |
| `hermesagent` | `restart`, `viewlogs`, `regenpassword`, `downloadbackup`, `healthcheck`, `redeploy*`, `killswitch*` | module functions; logs/health → `data.logs`, password → `data.password`, backup → `data.file` one-time link |
| `ArkHostHetznerVPS` | `Start`, `Stop*`, `Reboot`, `VNC` | module functions; VNC → `data.url` one-time console page + `data.password` |
| `pvewhmcs` | `vmStart`, `vmReboot`, `vmShutdown*`, `vmStop*`, `noVNC` | module functions; noVNC → `data.url` |
| `puqProxmoxKVM` | values of its `ClientAreaCustomButtonArray()` / `ClientAreaAllowedFunctions()` | module functions; stop/reinstall/reset-like names need confirm |
| `snbdpanel` | `resetpassword` | the module's signed panel call; → `data.password` |
| `cpanel` | none — use `service.sso` | |

## Files

- `snbd_portal_bridge.php` — addon config / activate / deactivate / admin page hooks.
- `bridge.php` — the endpoint. `handoff.php` — one-time download / console links. `install.php` — CLI installer.
- `lib/` — `Auth`, `Request`, `Response`, `Endpoint`, `Ops`, `Actions`, `Panels`, `Catalog`, `Sanitize`,
  `Guard`, `Handoff`, `Settings`, `Store`/`CapsuleStore`, `Api`, `Modules`/`WhmcsModuleHandle`, `AdminPage`, `Installer`.
- Tests (outside the module): `whmcs-module/tests/run.php` — `php tests/run.php`, no WHMCS needed.
