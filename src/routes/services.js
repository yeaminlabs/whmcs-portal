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

const useBridge = () => config.bridge.enabled || config.useMock;
const notFound = (res, back) => res.status(404).render('error', { title: 'Not found', message: 'We could not find that in your account.', back });
const serviceId = (req) => (/^\d{1,10}$/.test(req.params.id) ? Number(req.params.id) : 0);
const wantsJson = (req) => String(req.get('accept') || '').includes('application/json');
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);

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
  let result = null;
  const stored = req.session.svcResult;
  if (stored && stored.id === service.id) result = stored;
  delete req.session.svcResult;
  const confirmAction = actions.find((a) => a.fn === req.query.confirm) || null;
  res.render(`service/${kind}`, {
    title: service.name || 'Service', view, kind, service, panel: view.panel || {}, actions,
    active: service.status === 'Active', upgrades, ordered: null, error: null, flash: res.locals.flash,
    result, confirmAction, k: kinds,
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

router.post('/services/:id/action', requireLogin, async (req, res, next) => {
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
  try {
    const out = await bridge('service.action', { clientId: req.session.clientId, serviceId: id, fn, confirm, args: {} });
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
  if (!useBridge()) return fail('svcx.unavailable');
  if (!kinds.CPANEL_APPS.includes(app)) return fail('svcx.err.bad_request');
  try {
    const out = await bridge('service.sso', { clientId: req.session.clientId, serviceId: id, app });
    const url = httpUrl(out && out.url);
    if (!url) return fail('svcx.err.sso');
    return res.redirect(303, url);
  } catch (e) {
    if (e.code === 'not_found') return notFound(res, '/services');
    console.warn(`[services] sso ${id} failed: ${e.code || e.message}`);
    return fail(e.code === 'not_active' ? 'svcx.err.not_active' : 'svcx.err.sso');
  }
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
