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

const ANALYTICS_API = 'https://analyticsdata.googleapis.com/v1beta/properties/';
function searchConsoleApi(siteUrl) {
  return 'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query';
}

function tokenFor(clientId, tool) {
  const d = gtokens.get(clientId);
  return d && d[tool] ? d[tool] : null;
}
function expired(token) {
  if (!token) return true;
  return Date.now() >= ((token.obtained_at || 0) + ((token.expires_in || 0) * 1000));
}

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

router.get('/data/:tool', requireLogin, async (req, res) => {
  const tool = req.params.tool;
  if (!['analytics', 'searchconsole'].includes(tool)) {
    return res.status(400).json({ error: 'Unknown tool.' });
  }
  const token = tokenFor(req.session.clientId, tool);
  if (!token) {
    return res.status(409).json({ error: 'not_connected', message: 'Connect ' + tool + ' first.' });
  }
  if (expired(token)) {
    return res.status(409).json({ error: 'expired', message: 'Token for ' + tool + ' expired; reconnect.' });
  }
  const authHeader = { Authorization: 'Bearer ' + token.access_token };
  try {
    let data;
    if (tool === 'analytics') {
      let propertyId = req.query.viewId;
      if (!propertyId) {
        const acctRes = await axios.get('https://analyticsadmin.googleapis.com/v1beta/accounts', { headers: authHeader });
        const accounts = acctRes.data.accounts || [];
        if (!accounts.length) return res.status(409).json({ error: 'no_ga4_account', message: 'No GA4 accounts found for this Google account.' });
        const propRes = await axios.get(
          'https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:' + accounts[0].name,
          { headers: authHeader }
        );
        const props = propRes.data.properties || [];
        if (!props.length) return res.status(409).json({ error: 'no_ga4_property', message: 'No GA4 properties found in ' + accounts[0].displayName + '.' });
        propertyId = props[0].name.split('/')[1];
      }
      const r = await axios.post(ANALYTICS_API + propertyId + ':runReport', {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
        dimensions: [{ name: 'date' }],
      }, { headers: authHeader });
      data = r.data;
    } else {
      let siteUrl = req.query.siteUrl;
      if (!siteUrl) {
        const sitesRes = await axios.get('https://www.googleapis.com/webmasters/v3/sites', { headers: authHeader });
        const sites = sitesRes.data.siteEntry || [];
        if (!sites.length) return res.status(409).json({ error: 'no_sc_site', message: 'No verified Search Console sites found. Add and verify a site at search.google.com/search-console.' });
        siteUrl = sites[0].siteUrl;
      }
      const r = await axios.post(searchConsoleApi(siteUrl), {
        startDate: '7daysAgo',
        endDate: 'today',
        dimensions: ['date'],
        rowLimit: 10,
      }, { headers: authHeader });
      data = r.data;
    }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'google_api_error', message: e.message });
  }
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
