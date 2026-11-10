'use strict';

/**
 * Language and display-currency preferences, stored in the `lang` and `cur`
 * cookies. Shared by POST /prefs and the `?lang=` / `?cur=` store links.
 */
const currency = require('./currency');
const { switchAccountCurrency } = require('./account-currency');
const { invalidateClient } = require('./client');
const { isLang } = require('./i18n');

const MAX_AGE = 365 * 24 * 3600 * 1000;

/**
 * Sets the cookies for a valid `lang` and a known `cur`. With `switchAccount`, a
 * signed-in client's WHMCS account currency follows `cur` when WHMCS allows it.
 */
async function applyPrefs(req, res, { lang, cur } = {}, { switchAccount = false } = {}) {
  const opts = { maxAge: MAX_AGE, sameSite: 'lax', secure: req.secure, httpOnly: true, path: '/' };
  if (isLang(lang)) res.cookie('lang', lang, opts);
  if (!cur) return;
  const list = await currency.listCurrencies();
  const picked = list.find((c) => c.code === cur);
  if (!picked) return;
  res.cookie('cur', picked.code, opts);
  if (!switchAccount || !req.session.clientId) return;
  const account = await currency.accountCurrency(req);
  if (!account || account.code === picked.code) return;
  try {
    const r = await switchAccountCurrency(req.session.clientId, picked);
    invalidateClient(req.session.clientId);
    if (r.switched) {
      req.session.currency = { id: picked.id, code: picked.code, prefix: picked.prefix };
      req.session.flash = { type: 'ok', key: 'cur.switched', vars: { code: picked.code } };
    } else if (r.reason !== 'same') {
      req.session.flash = { type: 'info', key: r.reason === 'credit' ? 'cur.keptCredit' : 'cur.keptHistory', vars: { code: picked.code, bill: account.code } };
    }
  } catch (err) {
    console.error('[prefs] account currency switch failed:', err.message);
    req.session.flash = { type: 'err', key: 'cur.switchFailed', vars: { code: picked.code, bill: account.code } };
  }
}

module.exports = { applyPrefs };
