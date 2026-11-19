# WHMCS portal → client app SSO

The app accepts a short-lived, one-time signed redirect at `/auth/sso`.
Configure the same random `SSO_SHARED_SECRET` in both applications.

The WHMCS portal login hook should redirect the already-authenticated owner to:

```text
https://app.snbdhost.com/auth/sso?client_id={id}&expires={unix}&nonce={random_hex}&next=%2Fdashboard&signature={signature}
```

Sign this exact UTF-8 string with HMAC-SHA256 using the shared secret:

```text
{client_id}|{expires}|{nonce}|{next}
```

`expires` must be within 120 seconds, the nonce is single-use, and `next` must
be a same-site path. The app looks up the client in WHMCS before creating its
own session, so the redirect never carries an email, password, or client name.
