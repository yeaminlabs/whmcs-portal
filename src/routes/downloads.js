'use strict';

/**
 * Downloads & setup kits: a page of useful downloads and three SNBD guides.
 * The domain sheet is built only from the customer's own service (WHMCS) plus the nameservers
 * SNBD publishes in its knowledge base; nothing is invented.
 */
const express = require('express');
const whmcs = require('../lib/whmcs');
const { requireLogin } = require('../middleware/auth');
const kits = require('../content/setup-kits');

const router = express.Router();

const HOSTING_GROUP = /(shared|reseller|premium)\s+hosting/i;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const arr = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

/** The signed-in customer's own hosting services (shared, reseller, premium). */
async function hostingServices(req) {
  const data = await whmcs.call('GetClientsProducts', { clientid: req.session.clientId }).catch(() => null);
  const rows = arr(data && data.products && data.products.product);
  return rows.filter((s) => HOSTING_GROUP.test(String(s.groupname || '')) && !/n8n/i.test(String(s.groupname || '')) && ['Active', 'Pending'].includes(s.status));
}

const brief = (s) => ({ id: String(s.id), name: String(s.name || '').trim(), domain: String(s.domain || '').trim(), status: s.status });

/** Template helpers: pick the text in the page language and the other language as a quiet second line. */
function langHelpers(lang) {
  const L = lang === 'bn' ? 'bn' : 'en';
  const O = L === 'bn' ? 'en' : 'bn';
  return { L, O, pick: (o) => (o && (o[L] || o.en)) || '', other: (o) => (o && o[O]) || '' };
}

const renderKit = (res, view, extra) => res.render(view, { title: 'Downloads', kitsPage: true, ...langHelpers(res.locals.lang), ...extra });

router.get('/downloads', requireLogin, async (req, res) => {
  const [hosting, legacy] = await Promise.all([
    hostingServices(req).catch(() => []),
    whmcs.isBlocked('GetDownloads') ? null : whmcs.call('GetDownloads', {}).catch(() => null),
  ]);
  const files = arr(legacy && legacy.downloads && legacy.downloads.download);
  renderKit(res, 'downloads', {
    featured: kits.CARDS.filter((c) => c.featured),
    more: kits.CARDS.filter((c) => !c.featured),
    hosting: hosting.map(brief).filter((s) => s.status === 'Active'),
    items: files,
  });
});

router.get('/downloads/email-setup', requireLogin, async (req, res) => {
  const hosting = (await hostingServices(req).catch(() => [])).map(brief).filter((s) => s.status === 'Active');
  renderKit(res, 'kit-email', { docTitle: langHelpers(res.locals.lang).pick(kits.EMAIL_GUIDE.title), guide: kits.EMAIL_GUIDE, hosting });
});

router.get('/downloads/bkash-invoice', requireLogin, (req, res) => {
  renderKit(res, 'kit-bkash', { docTitle: langHelpers(res.locals.lang).pick(kits.BKASH_GUIDE.title), guide: kits.BKASH_GUIDE });
});

router.get('/downloads/domain-connection', requireLogin, async (req, res) => {
  const services = (await hostingServices(req).catch(() => [])).filter((s) => HOST_RE.test(String(s.domain || '').trim()));
  const wanted = String(req.query.service || '');
  const chosen = services.find((s) => String(s.id) === wanted) || services[0] || null;
  let sheet = null;
  if (chosen) {
    const own = [chosen.ns1, chosen.ns2].map((v) => String(v || '').trim()).filter((v) => HOST_RE.test(v));
    const ipRaw = String(chosen.dedicatedip || chosen.serverip || '').trim();
    sheet = {
      domain: String(chosen.domain).trim().toLowerCase(),
      plan: String(chosen.name || '').trim(),
      nameservers: own.length ? own : kits.DEFAULT_NAMESERVERS,
      ip: IPV4_RE.test(ipRaw) ? ipRaw : '',
    };
    const lines = [
      `Domain: ${sheet.domain}`,
      `Hosting: ${sheet.plan}`,
      '',
      'Option A (recommended) - change nameservers at the registrar:',
      ...sheet.nameservers.map((n) => `  ${n}`),
    ];
    if (sheet.ip) lines.push('', 'Option B - keep DNS elsewhere and add these records:', `  A      @     ${sheet.ip}`, `  CNAME  www   ${sheet.domain}`);
    lines.push('', 'Changes can take 1 to 24 hours to show everywhere.');
    sheet.copyAll = lines.join('\n');
  }
  renderKit(res, 'kit-domain', {
    docTitle: langHelpers(res.locals.lang).pick(kits.DOMAIN_SHEET.title), guide: kits.DOMAIN_SHEET,
    services: services.map(brief), selected: chosen ? String(chosen.id) : '', sheet,
  });
});

module.exports = router;
