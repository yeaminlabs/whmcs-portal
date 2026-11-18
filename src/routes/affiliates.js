'use strict';

const express = require('express');
const { requireLogin } = require('../middleware/auth');
const affiliates = require('../lib/affiliates');
const catalog = require('../lib/catalog');
const whmcs = require('../lib/whmcs');

const router = express.Router();

/** Public WHMCS address that serves aff.php (the internal API origin does not). */
async function publicBase() {
  const config = require('../config');
  const base = config.whmcsStoreUrl || (await catalog.storeBase('').catch(() => '')) || config.whmcsUrl;
  return /^https:\/\//i.test(base) ? base : '';
}

router.get('/affiliates', requireLogin, async (req, res) => {
  const info = await affiliates.status(req.session.clientId);
  let link = '';
  if (info.state === 'active') {
    const base = await publicBase();
    if (base) link = `${base}/aff.php?aff=${encodeURIComponent(info.affiliate.id)}`;
  }
  res.render('affiliates', { title: 'Affiliates', info, link });
});

router.post('/affiliates/activate', requireLogin, async (req, res) => {
  const clientId = req.session.clientId;
  try {
    // Activate only from the "inactive" state, so this can never touch an existing affiliate.
    const info = await affiliates.status(clientId);
    if (info.state === 'inactive') {
      const out = await affiliates.activate(clientId);
      req.session.flash = out.ok ? { type: 'ok', key: 'aff.activated' } : { type: 'err', key: 'aff.activateFailed' };
    } else if (info.state === 'active') {
      req.session.flash = { type: 'info', key: 'aff.alreadyActive' };
    } else {
      req.session.flash = { type: 'err', key: 'aff.activateFailed' };
    }
  } catch (e) {
    console.warn('[affiliates] activate failed:', e.message);
    req.session.flash = { type: 'err', key: 'aff.activateFailed' };
  }
  res.redirect(303, '/affiliates');
});

// WHMCS has no API for payout requests, so payouts continue on its own affiliate page.
router.post('/affiliates/payout', requireLogin, async (req, res) => {
  try {
    const data = await whmcs.call('CreateSsoToken', { client_id: req.session.clientId, destination: 'sso:custom_redirect', sso_redirect_path: 'affiliates.php' });
    if (data && data.result === 'success' && /^https?:\/\//i.test(String(data.redirect_url || ''))) return res.redirect(303, data.redirect_url);
  } catch (e) {
    console.warn('[affiliates] payout link failed:', e.message);
  }
  req.session.flash = { type: 'err', key: 'aff.payoutFailed' };
  return res.redirect(303, '/affiliates');
});

module.exports = router;
