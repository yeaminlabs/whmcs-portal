'use strict';

/**
 * Every sign-in path (password, Google, WHMCS handoff) goes through here. When the client
 * has two-factor on, the session is parked as "pending" and the user must pass the code
 * challenge at /login/2fa before a real session starts.
 */
const { signIn } = require('./signin');
const store = require('./twofactor-store');

const PENDING_TTL_MS = 5 * 60 * 1000;

async function completeSignIn(req, fields, method = 'password', next = '/') {
  if (!store.isEnabled(fields.clientId)) {
    await signIn(req, fields, method);
    return { challenge: false };
  }
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.pending2fa = { fields, method, next, fails: 0, at: Date.now() };
  return { challenge: true };
}

/** The pending challenge if it is still fresh, else null (and it is cleared). */
function pendingChallenge(req) {
  const p = req.session.pending2fa;
  if (!p) return null;
  if (Date.now() - p.at > PENDING_TTL_MS) {
    delete req.session.pending2fa;
    return null;
  }
  return p;
}

module.exports = { completeSignIn, pendingChallenge, PENDING_TTL_MS };
