'use strict';

/**
 * Per-product service dashboards driven by the WHMCS bridge (docs/BRIDGE_CONTRACT.md).
 * Mounted before routes/portal.js, so GET /services/:id here wins; the upgrade and
 * cancel POST routes stay in portal.js.
 */
const express = require('express');
const config = require('../config');
const whmcs = require('../lib/whmcs');
const catalog = require('../lib/catalog');
const kinds = require('../lib/service-kinds');
const { bridge } = require('../lib/bridge');
const { requireLogin } = require('../middleware/auth');
const { cleanStr } = require('../lib/validators');
const { ownedService } = require('../lib/ownership');

const router = express.Router();

/** In-memory sliding-window rate limiter: 10 req/min per client IP. */
const actionRateLimiter = (() => {
  const windowMs = 60000;
  const maxRequests = 10;
  const hits = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = hits.get(ip) || [];
    const recent = arr.filter((t) => now - t < windowMs);
    if (recent.length >= maxRequests) {
      const oldest = recent[0];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, code: 'rate_limited', message: 'Too many actions, please wait.' });
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 10000) {
      for (const [k, v] of hits) {
        const r = v.filter((t) => now - t < windowMs);
        r.length ? hits.set(k, r) : hits.delete(k);
      }
    }
    next();
  };
})();

const useBridge = () => config.bridge.enabled || config.useMock;
const notFound = (res, back) => res.status(404).render('error', { title: 'Not found', message: 'We could not find that in your account.', back });
const serviceId = (req) => (/^\d{1,10}$/.test(req.params.id) ? Number(req.params.id) : 0);
const wantsJson = (req) => String(req.get('accept') || '').includes('application/json');
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : null);

const ERROR_STATUS = { bad_request: 400, not_allowed: 403, not_found: 404, not_active: 409, confirm_required: 428 };

function fnLabel(t, fn, fallback) {
  const key = `svcx.fn.${fn}`;
  const v = t(key);
  return v === key ? (fallback || fn) : v;
}

function errText(t, e) {
  const key = `svcx.err.${e.code}`;
  const v = t(key);
  return v === key ? t('svcx.err.internal') : v;
}

/** Keep only the result fields the contract defines, with safe URLs. */
function resultData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const out = {};
  if (httpUrl(d.url)) out.url = d.url;
  if (typeof d.password === 'string' && d.password) out.password = d.password.slice(0, 200);
  if (typeof d.logs === 'string') out.logs = d.logs.split('\n').slice(-200).join('\n');
  if (d.file && httpUrl(d.file.url)) out.file = { name: cleanStr(String(d.file.name || 'download'), 200) || 'download', url: d.file.url };
  if (d.disk && typeof d.disk === 'object') out.disk = {
    usedBytes: Number.isFinite(Number(d.disk.usedBytes)) ? Number(d.disk.usedBytes) : null,
    sizeBytes: Number.isFinite(Number(d.disk.sizeBytes)) ? Number(d.disk.sizeBytes) : null,
    error: cleanStr(String(d.disk.error || ''), 300) || null,
  };
  if (d.planStorageGb != null) out.planStorageGb = cleanStr(String(d.planStorageGb), 40);
  if (d.env && typeof d.env === 'object') out.env = d.env;
  if (typeof d.token === 'string' && d.token) out.token = d.token.slice(0, 4096);
  if (Number.isFinite(Number(d.ttl))) out.ttl = Number(d.ttl);
  if (typeof d.endpoint === 'string') out.endpoint = cleanStr(d.endpoint, 32);
  if (httpsUrl(d.wsUrl)) out.wsUrl = d.wsUrl;
  return out;
}

async function renderDashboard(req, res, view) {
  const t = res.locals.t;
  const kind = kinds.kindOf(view);
  const service = view.service || {};
  const upgrades = await catalog.siblingsOf(service.pid, res.locals.displayCurrency.code).catch(() => []);
  const actions = (Array.isArray(view.actions) ? view.actions : []).map((a) => ({
    fn: String(a.fn), label: fnLabel(t, a.fn, a.label), confirm: Boolean(a.confirm), danger: Boolean(a.danger),
    icon: kinds.fnIcon(a.fn), console: kinds.CONSOLE_FNS.includes(a.fn),
  }));
  const n8nUpgrade = kind === 'n8n'
    ? actions.find((a) => /^(upgrade|update)$/i.test(a.fn))
    : null;
  const n8nUpdate = n8nUpgrade ? {
    action: n8nUpgrade,
    current: String((view.panel || {}).version || '').trim(),
    target: String((view.panel || {}).targetVersion || config.n8nTargetVersion || '').trim(),
    cooldown: Math.max(0, Number((view.panel || {}).cooldown) || 0),
  } : null;
  let result = null;
  const stored = req.session.svcResult;
  if (stored && stored.id === service.id) result = stored;
  delete req.session.svcResult;
  const confirmAction = actions.find((a) => a.fn === req.query.confirm) || null;
  res.render(`service/${kind}`, {
    title: service.name || 'Service', view, kind, service, panel: view.panel || {}, actions,
    sso: Array.isArray(view.sso) ? view.sso : [], active: service.status === 'Active', upgrades, ordered: null, error: null, flash: res.locals.flash,
    result, confirmAction, k: kinds,
    n8nUpdate,
  });
}

router.get('/services/:id', requireLogin, async (req, res, next) => {
  const id = serviceId(req);
  if (!id) return next();
  if (useBridge()) {
    try {
      const view = await bridge('service.view', { clientId: req.session.clientId, serviceId: id });
      return await renderDashboard(req, res, view);
    } catch (e) {
      if (e.code === 'not_found') return notFound(res, '/services');
      console.warn(`[services] service.view ${id} failed: ${e.code || e.message}`);
    }
  }
  try {
    const service = await ownedService(req.session.clientId, id);
    if (!service) return notFound(res, '/services');
    const upgrades = await catalog.siblingsOf(service.pid, res.locals.displayCurrency.code).catch(() => []);
    res.locals.flash = { type: 'info', key: 'svcx.unavailable' };
    res.render('service-detail', { title: service.name || 'Service', service, upgrades, ordered: null, error: null });
  } catch (e) {
    res.render('error', { title: 'Service', message: e.message, back: '/services' });
  }
});

router.post('/services/:id/action', requireLogin, actionRateLimiter, async (req, res, next) => {
  const id = serviceId(req);
  if (!id) return next();
  const t = res.locals.t;
  const back = `/services/${id}`;
  const fn = cleanStr(req.body.fn, 64);
  const confirm = req.body.confirm === true || ['1', 'true', 'on', 'yes'].includes(String(req.body.confirm));
  const label = fnLabel(t, fn);
  const json = wantsJson(req);

  const reply = (status, payload) => {
    if (json) return res.status(status).json(payload);
    req.session.flash = { type: payload.ok ? 'ok' : 'err', text: payload.detail ? `${payload.message} ${payload.detail}` : payload.message };
    if (payload.ok && payload.data && Object.keys(payload.data).length) {
      req.session.svcResult = { id, fn, label, data: payload.data };
      return res.redirect(303, `${back}#svc-result`);
    }
    return res.redirect(303, back);
  };

  if (!useBridge()) return reply(503, { ok: false, code: 'unavailable', message: t('svcx.unavailable') });
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(fn) || /^admin/i.test(fn)) {
    return reply(403, { ok: false, code: 'not_allowed', message: t('svcx.err.not_allowed') });
  }
  let args = {};
  if (typeof req.body.args === 'string' && req.body.args.trim()) {
    try { args = JSON.parse(req.body.args); } catch (e) { return reply(400, { ok: false, code: 'bad_request', message: t('svcx.err.bad_request') }); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return reply(400, { ok: false, code: 'bad_request', message: t('svcx.err.bad_request') });
  }
  if (req.body.password || req.body.email) args = { ...args, password: req.body.password, email: req.body.email };
  if (req.body.env) {
    try { args = { ...args, env: JSON.parse(req.body.env) }; } catch (e) { return reply(400, { ok: false, code: 'bad_request', message: t('svcx.err.bad_request') }); }
  }
  try {
    const out = await bridge('service.action', { clientId: req.session.clientId, serviceId: id, fn, confirm, args });
    const detail = res.locals.lang === 'en' ? cleanStr(String((out && out.message) || ''), 500) : '';
    return reply(200, { ok: true, message: t('svcx.done', { action: label }), detail, data: resultData(out && out.data) });
  } catch (e) {
    if (e.code === 'not_found') return json ? res.status(404).json({ ok: false, code: 'not_found', message: t('err.notFound') }) : notFound(res, '/services');
    if (e.code === 'confirm_required' && !json) return res.redirect(303, `${back}?confirm=${encodeURIComponent(fn)}#svc-confirm`);
    if (!ERROR_STATUS[e.code]) console.warn(`[services] action ${fn} on ${id} failed: ${e.code || e.message}`);
    const detail = e.code === 'module_error' ? cleanStr(String(e.message || ''), 300) : '';
    return reply(ERROR_STATUS[e.code] || 502, { ok: false, code: e.code || 'internal', message: errText(t, e), detail });
  }
});

router.post('/services/:id/sso', requireLogin, async (req, res, next) => {
  const id = serviceId(req);
  if (!id) return next();
  const t = res.locals.t;
  const app = typeof req.body.app === 'string' ? req.body.app : '';
  const fail = (key) => {
    req.session.flash = { type: 'err', text: t(key) };
    return res.redirect(303, `/services/${id}`);
  };
  if (!kinds.CPANEL_APPS.includes(app)) return fail('svcx.err.bad_request');

  const whmcsSsoFallback = async () => {
    const path = `clientarea.php?action=productdetails&id=${id}&dosinglesignon=1${app ? `&app=${encodeURIComponent(app)}` : ''}`;
    if (useBridge()) {
      const out = await bridge('whmcs.sso', { clientId: req.session.clientId, path }).catch(() => null);
      return httpsUrl(out && out.url);
    }
    if (!(await ownedService(req.session.clientId, id).catch(() => false))) return null;
    const data = await whmcs.call('CreateSsoToken', { client_id: req.session.clientId, destination: 'sso:custom_redirect', sso_redirect_path: path }).catch(() => null);
    return data && data.result === 'success' ? httpsUrl(data.redirect_url) : null;
  };

  if (useBridge()) {
    try {
      const out = await bridge('service.sso', { clientId: req.session.clientId, serviceId: id, app });
      const url = httpsUrl(out && out.url);
      if (url) return res.redirect(303, url);
    } catch (e) {
      if (e.code === 'not_found') return notFound(res, '/services');
      if (e.code === 'not_active') return fail('svcx.err.not_active');
      console.warn(`[services] direct sso ${id} failed (${e.code || e.message}), trying whmcs fallback`);
    }
  }

  // Fallback to WHMCS native SSO to login to cPanel
  try {
    const fallbackUrl = await whmcsSsoFallback();
    if (fallbackUrl) return res.redirect(303, fallbackUrl);
  } catch (e) {
    console.warn(`[services] whmcs sso fallback ${id} failed: ${e.message}`);
  }

  return fail(useBridge() ? 'svcx.err.sso' : 'svcx.unavailable');
});

router.post('/services/:id/manage', requireLogin, async (req, res, next) => {
  const id = serviceId(req);
  if (!id) return next();
  const t = res.locals.t;
  const clientId = req.session.clientId;
  const path = `clientarea.php?action=productdetails&id=${id}`;
  const fail = () => {
    req.session.flash = { type: 'err', text: t('svcx.err.sso') };
    return res.redirect(303, `/services/${id}`);
  };
  try {
    let url;
    if (useBridge()) {
      const [owned, out] = await Promise.all([
        bridge('batch', { clientId, calls: [{ key: 'svc', action: 'GetClientsProducts', params: { serviceid: id } }] }),
        bridge('whmcs.sso', { clientId, path }),
      ]);
      const rows = (owned && owned.svc && owned.svc.products && owned.svc.products.product) || [];
      if (![].concat(rows).some((p) => String(p.id) === String(id))) return notFound(res, '/services');
      url = httpUrl(out && out.url);
    } else {
      if (!(await ownedService(clientId, id))) return notFound(res, '/services');
      const data = await whmcs.call('CreateSsoToken', { client_id: clientId, destination: 'sso:custom_redirect', sso_redirect_path: path });
      url = data && data.result === 'success' ? httpUrl(data.redirect_url) : null;
    }
    return url ? res.redirect(303, url) : fail();
  } catch (e) {
    if (e.code === 'not_found') return notFound(res, '/services');
    console.warn(`[services] manage ${id} failed: ${e.code || e.message}`);
    return fail();
  }
});

module.exports = router;
