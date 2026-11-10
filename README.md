# SNBD HOST Client Portal

A fast, branded client area for [SNBD HOST](https://snbdhost.com), built on Node.js and powered by the WHMCS installation at `portal.snbdhost.com`. Customers manage services, domains, invoices and support, order new products, and pay with bKash or card without leaving the portal. The UI is available in English and Bangla, and prices can be shown in any WHMCS currency.

Live (test): https://portal.bysnbdhost.top

## Features

- **Dashboard** with account summary, services, domains, invoices and tickets.
- **Store** mirroring `portal.snbdhost.com/store`: shared hosting (domain step), VPS (hostname, root password, nameservers), n8n and more. Retired plans are hidden by syncing visibility from the public store.
- **Payments**:
  - bKash (Tokenized Checkout) and Stripe (card form on the page) are processed in the portal and recorded in WHMCS with `AddInvoicePayment`.
  - Account credit can be applied directly.
  - Other gateways continue on the WHMCS invoice page through a one-time login link (SSO).
- **Currency**: every amount follows the WHMCS rates and number formats. The navbar switch changes the display currency, and also the account's billing currency for accounts with no payment history (unpaid invoices and renewal prices are converted, with rollback on failure).
- **Language**: English and বাংলা, switchable from the navbar on every page, including login.
- **Product dashboards** (through the WHMCS bridge addon): cPanel hosting, n8n and OpenClaw, Hermes AI agents, and VPS (Hetzner via ArkHost, Proxmox, snbdpanel).
- **Security**:
  - Every record is checked against the signed-in client.
  - Secrets are scrubbed from logs.
  - helmet, rate limiting, httpOnly secure session cookies, and signed bridge requests.

## Project layout

```
src/
  server.js            Express app, i18n + currency middleware, /prefs
  config.js            Environment configuration
  routes/              auth, portal (client area), store, pay, services
  lib/
    whmcs.js           WHMCS External API client
    bridge.js          Signed client for the WHMCS bridge addon
    catalog.js         Store catalog from GetProducts
    currency.js        WHMCS-style conversion and formatting
    account-currency.js  Safe account-currency switch with rollback
    ownership.js       Client-scoped record lookups
    payments/          Stripe, bKash, payment recording
  i18n/                en / bn dictionaries
views/                 EJS templates
public/                CSS, fonts, images
whmcs-module/          WHMCS addon `snbd_portal_bridge` (PHP)
docs/BRIDGE_CONTRACT.md  Portal ↔ WHMCS bridge protocol
```

## Requirements

- Node.js 18+
- A WHMCS 8.x installation with an API credential (identifier + secret). The WHMCS API IP allowlist must include the portal server's IP.
- Optional: the `snbd_portal_bridge` addon installed in WHMCS for product dashboards and single-request pages.

## Setup

```bash
npm install
cp .env.example .env   # fill in the values
npm start              # http://localhost:3000
```

Set `MOCK_MODE=true` to run with demo data and no WHMCS. Demo logins: `demo@example.com` / `demo1234` (has payment history) and `new@example.com` / `demo1234` (no payments, can switch currency).

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `SESSION_SECRET` | Long random string for session cookies |
| `WHMCS_URL` | WHMCS base URL, no trailing slash |
| `WHMCS_IDENTIFIER`, `WHMCS_SECRET` | WHMCS API credential |
| `MOCK_MODE` | `true` to use demo data |
| `GOOGLE_CLIENT_ID` | Google Sign-In client ID (origin must be authorised in Google Cloud) |
| `BRIDGE_URL`, `BRIDGE_SECRET` | WHMCS bridge addon endpoint and shared secret |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CURRENCY_ID`, `STRIPE_WEBHOOK_SECRET` | In-portal card payments (currency id = WHMCS "convert to" currency) |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_SANDBOX`, `BKASH_FEE_PERCENT`, `BKASH_CURRENCY_ID` | In-portal bKash payments |

Never commit `.env`. Payment and bridge secrets belong only on the server.

## WHMCS API permissions

The API role used by the portal needs at least:
- **Clients and services**: `GetClientsDetails`, `GetClientsProducts`, `GetClientsDomains`, `GetClientsAddons`, `UpdateClient`, `UpdateClientProduct`, `UpdateClientDomain`, `UpdateClientAddon`, `ValidateLogin`, `AddClient`.
- **Billing**: `GetInvoices`, `GetInvoice`, `UpdateInvoice`, `ApplyCredit`, `AddInvoicePayment`, `GetTransactions`, `GetPaymentMethods`, `GetCurrencies`, `CreateSsoToken`.
- **Store and orders**: `GetProducts`, `GetTLDPricing`, `DomainWhois`, `AddOrder`.
- **Support**: `GetSupportTickets`, `GetSupportTicket`, `GetSupportDepartments`, `OpenTicket`, `AddTicketReply`, `UpdateTicket`.
- **Service and domain management**: `UpgradeProduct`, `AddCancelRequest`, `DomainUpdateNameservers`, `DomainGetNameservers`, `DomainGetLockingStatus`, `DomainUpdateLockingStatus`, `RenewDomain`.
- **Content**: `GetQuotes`, `AcceptQuote`, `GetEmails`, `GetContacts`, `GetAnnouncements`, `GetKBArticles`, `GetDownloads`, `GetServers`, `SendContact`, `GetAffiliates`.

## WHMCS bridge addon

See `whmcs-module/modules/addons/snbd_portal_bridge/README.md` and `docs/BRIDGE_CONTRACT.md`.

## Deployment

The portal runs as a systemd service behind nginx with a Let's Encrypt certificate:

```ini
# /etc/systemd/system/whmcs-portal.service
[Service]
User=whmcsportal
WorkingDirectory=/opt/whmcs-portal
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
```

nginx proxies `portal.bysnbdhost.top` to `127.0.0.1:3000` and forwards `X-Forwarded-*` headers. Express trusts the loopback proxy.
