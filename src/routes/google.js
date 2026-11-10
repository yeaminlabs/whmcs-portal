'use strict';

const express = require('express');
const axios = require('axios');
const { requireLogin } = require('../middleware/auth');
const config = require('../config');
const gtokens = require('../lib/google-tokens');

const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

function portalUrl() {
  return process.env.PORTAL_URL || 'https://app.snbdhost.com';
}

function authUrl(clientId, tool) {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: portalUrl() + '/google/callback',
    scope: SCOPES.join(' '),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state: JSON.stringify({ clientId, tool }),
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

router.get('/connect/:tool', requireLogin, (req, res) => {
  const tool = req.params.tool;
  if (!['analytics', 'searchconsole'].includes(tool)) {
    return res.status(400).render('error', { title: 'Error', message: 'Unknown tool.', back: '/' });
  }
  res.redirect(authUrl(req.session.clientId, tool));
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).render('error', { title: 'Error', message: 'Missing OAuth parameters.', back: '/' });
  }
  let parsed;
  try { parsed = JSON.parse(state); } catch { return res.status(400).render('error', { title: 'Error', message: 'Invalid state.', back: '/' }); }
  if (parsed.clientId !== req.session.clientId) {
    return res.status(403).render('error', { title: 'Error', message: 'State mismatch.', back: '/' });
  }
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: portalUrl() + '/google/callback',
      grant_type: 'authorization_code',
    });
    gtokens.set(req.session.clientId, parsed.tool, {
      access_token: tokenRes.data.access_token,
      refresh_token: tokenRes.data.refresh_token,
      expires_in: tokenRes.data.expires_in,
      obtained_at: Date.now(),
    });
    req.session.flash = { type: 'success', message: 'Google tool connected.' };
    res.redirect('/google/tools');
  } catch (e) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to exchange OAuth code.', back: '/' });
  }
});

router.get('/disconnect/:tool', requireLogin, (req, res) => {
  const tool = req.params.tool;
  gtokens.del(req.session.clientId, tool);
  req.session.flash = { type: 'success', message: 'Google tool disconnected.' };
  res.redirect('/google/tools');
});

router.get('/tools', requireLogin, async (req, res) => {
  const connected = gtokens.tools(req.session.clientId);
  res.render('google-tools', {
    title: 'Connected Google Tools',
    connected,
    hasAnalytics: connected.includes('analytics'),
    hasSearchConsole: connected.includes('searchconsole'),
  });
});

module.exports = router;
