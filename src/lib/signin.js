'use strict';

/** Starting a client session after login, Google sign-in or registration. */
const currency = require('./currency');

const NEXT_RE = /^\/(?![\/\\])/;

/** A same-site path to continue to after signing in, or '' when `v` is not one. */
function nextParam(v) {
  return typeof v === 'string' && v.length <= 500 && NEXT_RE.test(v) && !/[\x00-\x1f\x7f]/.test(v) ? v : '';
}

const safeNext = (v) => nextParam(v) || '/';

/**
 * Regenerates the session (no fixation) and stores `fields` in it. A guest's
 * pendingOrder carries over; everything else, including the guest's currency, does not.
 */
function signIn(req, fields) {
  const { pendingOrder } = req.session;
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  }).then(async () => {
    Object.assign(req.session, fields);
    if (pendingOrder) req.session.pendingOrder = pendingOrder;
    await currency.accountCurrency(req).catch(() => null);
  });
}

module.exports = { nextParam, safeNext, signIn };
