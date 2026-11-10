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

const ANALYTICS_API = 'https://analyticsreporting.googleapis.com/v4/reports:batchGet';
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
  try {
    let data;
    if (tool === 'analytics') {
      const viewId = req.query.viewId || process.env.GOOGLE_ANALYTICS_VIEW_ID;
      if (!viewId) {
        return res.status(409).json({ error: 'missing_view_id', message: 'Set GOOGLE_ANALYTICS_VIEW_ID or pass ?viewId=' });
      }
      const r = await axios.post(ANALYTICS_API, {
        reportRequests: [{
          viewId,
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics: [{ expression: 'ga:sessions' }, { expression: 'ga:pageviews' }],
          dimensions: [{ name: 'ga:date' }],
        }],
      }, { headers: { Authorization: 'Bearer ' + token.access_token } });
      data = r.data;
    } else {
      const siteUrl = req.query.siteUrl || process.env.GOOGLE_SEARCHCONSOLE_SITE_URL;
      if (!siteUrl) {
        return res.status(409).json({ error: 'missing_site_url', message: 'Set GOOGLE_SEARCHCONSOLE_SITE_URL or pass ?siteUrl=' });
      }
      const r = await axios.post(searchConsoleApi(siteUrl), {
        startDate: '7daysAgo',
        endDate: 'today',
        dimensions: ['date'],
        rowLimit: 10,
      }, { headers: { Authorization: 'Bearer ' + token.access_token } });
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
