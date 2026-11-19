'use strict';

const express = require('express');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const { requireLogin } = require('../middleware/auth');
const { safeNext, signIn } = require('../lib/signin');
const { pendingChallenge } = require('../lib/twofactor-gate');
const { cleanStr } = require('../lib/validators');
const totp = require('../lib/totp');
const store = require('../lib/twofactor-store');

const router = express.Router();
router.use(express.json());
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const SETUP_TTL_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

const cleanCode = (v) => cleanStr(String(v || ''), 20).trim();

const tMsg = (res, key) => {
  try { return res.locals && typeof res.locals.t === 'function' ? res.locals.t(key) : key; } catch (e) { return key; }
};
const jsonErr = (res, status, message) => res.status(status).json({ error: message });

// ---- Login challenge (after password or Google sign-in) ----
router.get('/login/2fa', (req, res) => {
  if (!pendingChallenge(req)) return res.redirect('/login');
  res.render('twofactor-verify', { title: 'Two-factor verification', error: null });
});

router.post('/login/2fa', codeLimiter, async (req, res) => {
  const p = pendingChallenge(req);
  if (!p) return res.redirect('/login');
  const t = res.locals.t;
  const code = cleanCode(req.body.code);
  const { clientId } = p.fields;
  const ok = store.acceptTotp(clientId, code) || store.acceptBackup(clientId, code);
  if (!ok) {
    p.fails += 1;
    if (p.fails >= MAX_FAILS) {
      delete req.session.pending2fa;
      return res.redirect('/login?error=2fa');
    }
    return res.status(401).render('twofactor-verify', { title: 'Two-factor verification', error: t('tf.invalidCode') });
  }
  const { fields, method, next } = p;
  delete req.session.pending2fa;
  try {
    await signIn(req, fields, method);
  } catch (e) {
    return res.status(500).render('error', { title: 'Error', message: 'Could not start session.', back: '/login' });
  }
  res.redirect(303, safeNext(next));
});

router.get('/login/2fa/cancel', (req, res) => {
  delete req.session.pending2fa;
  res.redirect('/login');
});

// ---- Security page: status, set up, remove ----
function securityView(req, res, extra = {}) {
  const tf = store.status(req.session.clientId);
  res.render('security', {
    title: 'Security', error: null, done: false, ...extra,
    twoFactor: tf.enabled, backupCodesLeft: tf.backupCodesLeft,
    tfNotice: req.query.tf || null,
  });
}

router.get('/security', requireLogin, (req, res) => securityView(req, res));

router.get('/security/2fa/setup', requireLogin, async (req, res) => {
  if (store.isEnabled(req.session.clientId)) return res.redirect('/security');
  const secret = totp.generateSecret();
  req.session.twofaSetup = { secret, at: Date.now() };
  renderSetup(req, res, null);
});

async function renderSetup(req, res, error, status = 200) {
  const setup = req.session.twofaSetup;
  const account = req.session.clientEmail || String(req.session.clientId);
  const uri = totp.otpauthUri({ secret: setup.secret, account, issuer: 'SNBD HOST' });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  res.status(status).render('twofactor-setup', {
    title: 'Set up two-factor', error, qr, secret: setup.secret.match(/.{1,4}/g).join(' '),
  });
}

router.post('/security/2fa/setup', requireLogin, codeLimiter, async (req, res) => {
  const setup = req.session.twofaSetup;
  if (!setup || Date.now() - setup.at > SETUP_TTL_MS) return res.redirect('/security/2fa/setup');
  if (store.isEnabled(req.session.clientId)) return res.redirect('/security');
  const code = cleanCode(req.body.code);
  if (totp.verify(setup.secret, code) < 0) {
    return renderSetup(req, res, res.locals.t('tf.invalidCode'), 422);
  }
  const backupCodes = totp.generateBackupCodes();
  store.enable(req.session.clientId, setup.secret, backupCodes);
  store.acceptTotp(req.session.clientId, code); // record this step so the same code cannot be replayed
  delete req.session.twofaSetup;
  res.render('twofactor-backup', { title: 'Backup codes', codes: backupCodes });
});

router.get('/security/2fa/disable', requireLogin, (req, res) => {
  if (!store.isEnabled(req.session.clientId)) return res.redirect('/security');
  res.render('twofactor-disable', { title: 'Remove two-factor', error: null });
});

router.post('/security/2fa/disable', requireLogin, codeLimiter, (req, res) => {
  const clientId = req.session.clientId;
  if (!store.isEnabled(clientId)) return res.redirect('/security');
  const code = cleanCode(req.body.code);
  const ok = store.acceptTotp(clientId, code) || store.acceptBackup(clientId, code);
  if (!ok) {
    return res.status(422).render('twofactor-disable', { title: 'Remove two-factor', error: res.locals.t('tf.invalidCode') });
  }
  store.disable(clientId);
  res.redirect(303, '/security?tf=off');
});

// ---- No-refresh JSON API for the security 2FA card ----
router.get('/api/2fa/status', requireLogin, (req, res) => {
  const tf = store.status(req.session.clientId);
  res.json({ enabled: tf.enabled, backupCodesLeft: tf.backupCodesLeft });
});

router.post('/api/2fa/setup', requireLogin, codeLimiter, async (req, res) => {
  const clientId = req.session.clientId;
  if (store.isEnabled(clientId)) return jsonErr(res, 409, 'Already enabled');
  const secret = totp.generateSecret();
  req.session.twofaSetup = { secret, at: Date.now() };
  const account = req.session.clientEmail || String(clientId);
  const uri = totp.otpauthUri({ secret, account, issuer: 'SNBD HOST' });
  let qr;
  try {
    qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  } catch (e) {
    return jsonErr(res, 500, 'Could not generate setup code.');
  }
  res.json({ secret, qr });
});

router.post('/api/2fa/setup/confirm', requireLogin, codeLimiter, async (req, res) => {
  const clientId = req.session.clientId;
  const setup = req.session.twofaSetup;
  if (!setup || Date.now() - setup.at > SETUP_TTL_MS) return jsonErr(res, 410, 'Setup session expired. Start again.');
  if (store.isEnabled(clientId)) return jsonErr(res, 409, 'Already enabled');
  const code = cleanCode(req.body.code);
  if (totp.verify(setup.secret, code) < 0) return jsonErr(res, 422, tMsg(res, 'tf.invalidCode'));
  const backupCodes = totp.generateBackupCodes();
  store.enable(clientId, setup.secret, backupCodes);
  store.acceptTotp(clientId, code);
  delete req.session.twofaSetup;
  res.json({ codes: backupCodes });
});

router.post('/api/2fa/remove', requireLogin, codeLimiter, (req, res) => {
  const clientId = req.session.clientId;
  if (!store.isEnabled(clientId)) return jsonErr(res, 409, 'Not enabled');
  const code = cleanCode(req.body.code);
  const ok = store.acceptTotp(clientId, code) || store.acceptBackup(clientId, code);
  if (!ok) return jsonErr(res, 422, tMsg(res, 'tf.invalidCode'));
  store.disable(clientId);
  res.json({ ok: true });
});

module.exports = router;
