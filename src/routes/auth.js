'use strict';

const express = require('express');
const whmcs = require('../lib/whmcs');
const { isEmail, cleanStr } = require('../lib/validators');
const avatars = require('../lib/avatars');

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

router.get('/login', (req, res) => {
  if (req.session.clientId) return res.redirect('/');
  res.render('login', { title: 'Log in', error: null, mock: require('../config').useMock });
});

router.post('/login', async (req, res) => {
  try {
    const email = cleanStr(req.body.email || '', 190).toLowerCase();
    const password = String(req.body.password || '').slice(0, 512);
    if (!isEmail(email) || !password) {
      return res.status(400).render('login', { title: 'Log in', error: 'Enter a valid email and password.', mock: require('../config').useMock });
    }
    const t = res.locals.t;
    const fail = (status, msg) => res.status(status).render('login', { title: 'Log in', error: msg, mock: require('../config').useMock });
    const data = await whmcs.call('ValidateLogin', { email, password2: password });
    if (data.result !== 'success') return fail(401, data.message || 'Login failed.');
    if (String(data.twoFactorEnabled) === 'true') return fail(403, t('authx.twoFactor'));

    // ValidateLogin returns the WHMCS *user* id; the portal works with the *client* the user owns.
    const owner = await ownedClientFor(data.userid, email);
    if (!owner) return fail(403, t('authx.notOwner'));
    req.session.regenerate((err) => {
      if (err) return renderError(res, 'Could not start session.');
      req.session.clientId = owner.clientId;
      req.session.userId = Number(data.userid);
      req.session.clientName = owner.name || email;
      req.session.clientEmail = owner.email || email;
      req.session.clientPicture = avatars.get(owner.clientId);
      res.redirect('/');
    });
  } catch (e) {
    res.status(500).render('login', { title: 'Log in', error: 'Login service unavailable. Try again.', mock: require('../config').useMock });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
