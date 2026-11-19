'use strict';

const express = require('express');
const { requireLogin } = require('../middleware/auth');
const dnsLookup = require('../lib/dns-lookup');

const router = express.Router();

router.get('/dns-lookup', requireLogin, async (req, res) => {
  const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
  const type = typeof req.query.type === 'string' ? req.query.type : 'A';
  let result = null;
  let error = null;
  if (domain) {
    try { result = await dnsLookup.lookup(domain, type); } catch (e) { error = e.message; }
  }
  res.render('dns-lookup', { title: 'DNS lookup', domain, type: dnsLookup.normalizeType(type) || 'A', result, error, types: dnsLookup.TYPES });
});

module.exports = router;
