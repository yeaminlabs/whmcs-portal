'use strict';

const express = require('express');
const whmcs = require('../lib/whmcs');
const { isEmail, cleanStr } = require('../lib/validators');
const avatars = require('../lib/avatars');
const { nextParam, safeNext } = require('../lib/signin');
const { completeSignIn } = require('../lib/twofactor-gate');
const config = require('../config');
const { consume } = require('../lib/portal-sso');
const mailer = require('../lib/mailer');
const resetTokens = require('../lib/reset-tokens');

const router = express.Router();

function renderError(res, message, back = '/') {
  return res.status(400).render('error', { title: 'Error', message, back });
}

/**
 * Finds the client account a WHMCS user owns. Returns null for sub-users that
 * only have delegated access, so they cannot act with owner rights here.
 */
async function ownedClientFor(userId, email) {
  const data = await whmcs.call('GetUsers', { search: email, limitnum: 25 });
  if (data.result !== 'success') return null;
  const list = Array.isArray(data.users) ? data.users : [];
  const user = list.find((u) => String(u.id) === String(userId));
  if (!user) return null;
  const owned = (user.clients || []).filter((c) => c.isOwner === true || String(c.isOwner) === 'true' || String(c.isOwner) === '1');
  if (!owned.length) return null;
  let pick = owned[0];
  if (owned.length > 1) {
    for (const c of owned) {
      const d = await whmcs.call('GetClientsDetails', { clientid: c.id }).catch(() => null);
      if (d && d.client && String(d.client.email).toLowerCase() === String(email).toLowerCase()) { pick = c; break; }
    }
  }
  return {
    clientId: Number(pick.id),
    name: `${user.firstname || ''} ${user.lastname || ''}`.trim(),
    email: user.email,
  };
}

const renderLogin = (res, status, error, next) => res.status(status).render('login', {
  title: 'Log in', error, next, mock: require('../config').useMock,
});

router.get('/login', (req, res) => {
  if (req.session.clientId) return res.redirect(safeNext(req.query.next));
  const notice = req.query.error === '2fa' ? res.locals.t('tf.tooMany') : null;
  renderLogin(res, 200, notice, nextParam(req.query.next));
});

// One-time signed handoff from the authenticated WHMCS portal.
router.get('/auth/sso', async (req, res) => {
  const next = nextParam(req.query.next) || '/';
  if (!consume({
    clientId: req.query.client_id,
    expires: req.query.expires,
    nonce: req.query.nonce,
    next,
    signature: req.query.signature,
    secret: config.ssoSharedSecret,
  })) return res.status(401).render('error', { title: 'Sign-in failed', message: 'This sign-in link is invalid or expired.', back: '/login' });
  try {
    const data = await whmcs.call('GetClientsDetails', { clientid: Number(req.query.client_id) });
    if (data.result !== 'success' || !data.client || Number(data.client.id) !== Number(req.query.client_id)) throw new Error('SSO_LOOKUP_FAILED');
    const { challenge } = await completeSignIn(req, {
      clientId: Number(data.client.id),
      clientName: data.client.fullname || `${data.client.firstname || ''} ${data.client.lastname || ''}`.trim() || data.client.email,
      clientEmail: data.client.email,
      clientPicture: avatars.get(Number(data.client.id)),
    }, 'sso', next);
    return res.redirect(303, challenge ? '/login/2fa' : next);
  } catch (e) {
    return res.status(502).render('error', { title: 'Sign-in failed', message: 'Could not start your portal session.', back: '/login' });
  }
});

router.post('/login', async (req, res) => {
  const next = nextParam(req.body.next);
  const fail = (status, msg) => renderLogin(res, status, msg, next);
  try {
    const email = cleanStr(req.body.email || '', 190).toLowerCase();
    const password = String(req.body.password || '').slice(0, 512);
    if (!isEmail(email) || !password) return fail(400, 'Enter a valid email and password.');
    const t = res.locals.t;
    const data = await whmcs.call('ValidateLogin', { email, password2: password });
    if (data.result !== 'success') return fail(401, data.message || 'Login failed.');

    // ValidateLogin returns the WHMCS *user* id; the portal works with the *client* the user owns.
    const owner = await ownedClientFor(data.userid, email);
    if (!owner) return fail(403, t('authx.notOwner'));
    try {
      const { challenge } = await completeSignIn(req, {
        clientId: owner.clientId,
        userId: Number(data.userid),
        clientName: owner.name || email,
        clientEmail: owner.email || email,
        clientPicture: avatars.get(owner.clientId),
      }, 'password', next);
      if (challenge) return res.redirect(303, '/login/2fa');
    } catch (err) {
      return renderError(res, 'Could not start session.');
    }
    res.redirect(303, safeNext(next));
  } catch (e) {
    fail(500, 'Login service unavailable. Try again.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---- Forget password / reset (token emailed via Mailgun, validated against WHMCS) ----
router.get('/forgot-password', (req, res) =>
  res.render('forgot-password', { title: 'Forgot password', error: null, sent: null })
);

router.post('/forgot-password', async (req, res) => {
  const t = res.locals.t;
  const email = cleanStr(req.body.email || '', 190).toLowerCase();
  const fail = (error) => res.status(400).render('forgot-password', { title: 'Forgot password', error, sent: null });
  if (!isEmail(email)) return fail(t('auth.enterEmail'));

  // Never reveal whether an email is registered: always render "check your inbox".
  let clientId = null;
  try {
    const data = await whmcs.call('GetClientsDetails', { email });
    if (data.result === 'success' && data.client) {
      clientId = Number(data.client.id || data.client.clientid || data.client.userid);
    }
  } catch (e) { /* treat as unregistered */ }

  if (clientId) {
    const token = resetTokens.create(email, clientId);
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
    const text = t('pw.reset.body', { url: resetUrl, site: 'SNBD HOST' });
    await mailer.sendMail({
      to: email,
      subject: t('pw.reset.subject', { site: 'SNBD HOST' }),
      text,
    }).catch((e) => console.warn('[mailer] reset mail failed:', e.message));
  }
  res.render('forgot-password', { title: 'Forgot password', error: null, sent: true });
});

router.get('/reset-password', (req, res) => {
  const token = String(req.query.token || '');
  const entry = token ? resetTokens.valid(token) : null;
  if (!entry) {
    return res.render('error', { title: 'Invalid link', message: res.locals.t('pw.reset.invalidLink'), back: '/login' });
  }
  res.render('reset-password', { title: 'Reset password', token, error: null, done: null });
});

router.post('/reset-password', async (req, res) => {
  const t = res.locals.t;
  const token = String(req.body.token || '');
  const entry = resetTokens.valid(token);
  if (!entry) {
    return res.render('error', { title: 'Invalid link', message: t('pw.reset.invalidLink'), back: '/login' });
  }
  const fail = (error) => res.render('reset-password', { title: 'Reset password', token, error, done: null });
  const newpw = String(req.body.newpw || '');
  if (newpw.length < 8 || !/[a-z]/i.test(newpw) || !/[0-9]/.test(newpw)) return fail(t('sec.rule'));
  if (newpw !== String(req.body.confirmpw || '')) return fail(t('err.pwMatch'));
  try {
    const data = await whmcs.call('UpdateClient', { clientid: entry.clientId, password2: newpw });
    if (data.result !== 'success') return fail(data.message || t('err.pwFail'));
    resetTokens.consume(token);
    res.redirect(303, '/login?reset=1');
  } catch (e) { fail(t('err.pwFail')); }
});

module.exports = router;
