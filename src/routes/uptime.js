'use strict';

const express = require('express');
const { requireLogin } = require('../middleware/auth');
const uptime = require('../lib/uptime');
const checker = require('../lib/uptime-checker');
const { cleanStr } = require('../lib/validators');

const router = express.Router();

router.get('/uptime', requireLogin, async (req, res) => {
  const monitors = uptime.listByClient(req.session.clientId);
  const enriched = monitors.map((m) => ({
    ...m,
    uptime24: uptime.uptimePercent(m.id, 24),
    recent: uptime.recentChecks(m.id, 20),
  }));
  res.render('uptime', { title: 'Uptime', monitors: enriched });
});

router.post('/uptime/add', requireLogin, async (req, res) => {
  const name = cleanStr(req.body.name, 120);
  const urlRaw = cleanStr(req.body.url, 500);
  let url = urlRaw;
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  const interval = Number(req.body.interval) || 300;
  if (!name || !url) return res.redirect('/uptime');
  try { new URL(url); } catch (e) { return res.redirect('/uptime'); }
  uptime.add(req.session.clientId, { name, url, interval });
  res.redirect('/uptime');
});

router.post('/uptime/:id/delete', requireLogin, (req, res) => {
  uptime.remove(req.params.id, req.session.clientId);
  res.redirect('/uptime');
});

router.post('/uptime/:id/check', requireLogin, async (req, res) => {
  const m = uptime.get(req.params.id, req.session.clientId);
  if (!m) return res.redirect('/uptime');
  const r = await checker.probe(m.url, 10000);
  uptime.recordCheck(m.id, r);
  res.redirect('/uptime');
});

module.exports = router;
