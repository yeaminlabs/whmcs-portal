# Public store and guest checkout: contract

Goal: every product has a shareable link for the marketing site (snbdhost.com). Visitors can browse and configure without
logging in. Login or registration is asked for only at checkout, and then they go straight to the WHMCS-style payment screen.

## URLs (all public, no login)

| URL | Purpose |
|---|---|
| `/store` | All product groups |
| `/store/<group>` | Plans in a group, e.g. `/store/n8n` |
| `/store/<group>/<product>` | Configure one plan, e.g. `/store/n8n/n8n-1g` |
| `/order?pid=42` and `/cart.php?a=add&pid=42` | WHMCS-style links; 302 to the canonical `/store/<group>/<product>` |

Optional query parameters on all of the above:
- `cycle=annually` preselects the billing cycle.
- `cur=USD` sets the display currency (same cookie as `/prefs`).
- `lang=bn` sets the language.

When `cur` or `lang` is present, the server sets the cookie and 302-redirects to the same URL without those two parameters.

`/order/domain` (domain search) stays login-only for now.

## Guest checkout flow

1. `POST /store/<group>/<product>` by a guest runs the same validation as today, minus the parts that need a client:
   domain availability check, hostname, root password and nameserver prefixes, and that the billing cycle and payment
   method exist.
   - On success it stores `req.session.pendingOrder` and redirects 303 to `/checkout`.
   - On validation error it re-renders the configure page exactly like today.
2. `GET /checkout`
   - No `pendingOrder`: redirect to `/store`.
   - Otherwise render `views/checkout.ejs` with:
     ```js
     {
       title: 'Checkout',
       loggedIn: Boolean(req.session.clientId),
       error: null | string,
       next: '/checkout',
       order: {
         group: { slug, name },
         product: { slug, name, kind },            // kind: hosting | server | other
         cycle: { id, label, price, setup },        // in the display currency
         prefix, code,                              // display currency
         domainLine: 'Register example.com (1 year)' | null,
         hostname: 'server1.example.com' | null,
         paymentmethod: { module, name },
         total,                                     // price + setup (domain fee not included; WHMCS adds it)
         editUrl: '/store/<group>/<product>?cycle=<id>',
       },
       billedNote: null | 'Invoice will be in BDT',  // when display currency differs from the client's account currency
     }
     ```
3. `POST /checkout`
   - Guest: redirect 303 to `/login?next=/checkout`.
   - Logged in: re-validate and place the order with the same `AddOrder` code as the logged-in store flow, using the
     client's own account currency. Then clear `pendingOrder`.
   - Redirect 303 to `/invoices/<invoiceid>/pay`, with flash `{ type: 'ok', key: 'checkout.placed', vars: { order } }`.
4. The logged-in direct flow (`POST /store/<group>/<product>` by a client) also ends at `/invoices/<invoiceid>/pay` with
   the same flash, matching WHMCS, which goes from order to invoice payment.

## `pendingOrder` (session, server-side only)

```js
{ group, product, form: { billingcycle, paymentmethod, domainoption, domain, eppcode, hostname, rootpw, ns1prefix, ns2prefix, promocode }, createdAt }
```

- Expires after 2 hours.
- Must survive login, Google sign-in and registration. Each of those calls `session.regenerate`, so copy `pendingOrder`
  before regenerating and restore it after.
- Never render `rootpw` back into any page.

## Login, registration and Google sign-in accept `next`

- `GET /login?next=/checkout` and `GET /register?next=/checkout` put `next` into a hidden field.
- `POST /login`, `POST /register` and `POST /auth/google` (JSON `next`) redirect there on success.
- `next` must match `/^\/(?![\/\\])/`, otherwise `/`.
- Registration logs the new client in straight away: the `clientid` from `AddClient`, plus the client's name and email.

## Layout

- Routes set `res.locals.publicPage = true` for the store pages and `/checkout` when there is no client session.
- `views/_head.ejs` and `views/_foot.ejs` render a public layout in that case:
  - A top bar with the SNBD HOST logo (links to `/store`), category links, the language/currency menu, and
    "Log in" / "Create account" buttons that carry `?next=<currentPath>`.
  - No sidebar.
- Logged-in users keep the normal client-area layout on the same URLs.
- On the configure page, guests see the button text "Continue to checkout" instead of "Complete order".

## i18n files

- UI strings (layout, checkout page): `src/i18n/store.en.js` and `src/i18n/store.bn.js`.
- Route and error strings: `src/i18n/checkout.en.js` and `src/i18n/checkout.bn.js`.
- Both pairs are already merged in `src/lib/i18n.js`.
- Use key prefixes `pub.` (UI) and `checkout.` (routes). `checkout.placed` = "Order #{order} placed. Complete your payment below."
