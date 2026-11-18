'use strict';

/**
 * Affiliate program, backed by WHMCS.
 *
 * - status(clientId): is the customer an affiliate? WHMCS answers GetAffiliates {userid} with that
 *   customer's record, or the error "Client ID not found" when they have not activated. WHMCS IGNORES
 *   the older `clientid` filter and returns every affiliate, so a row is used only when its
 *   clientid equals the signed-in customer's. Nobody can ever see another affiliate's figures.
 * - activate(clientId): AffiliateActivate {userid}.
 * - settings(): AffiliateEnabled / AffiliateEarningPercent / AffiliatePayout from WHMCS (cached).
 */
const whmcs = require('./whmcs');
const { cached } = require('./cache');

const NOT_AN_AFFILIATE = /client id not found/i;
const SETTINGS_TTL = 10 * 60 * 1000;
const arr = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function setting(name) {
  const r = await whmcs.call('GetConfigurationValue', { setting: name });
  return r && r.result === 'success' ? r.value : null;
}

/** Program settings from WHMCS. `enabled` is false when the program is switched off there. */
function settings() {
  return cached('affiliates:settings', SETTINGS_TTL, async () => {
    const [enabled, percent, payout] = await Promise.all([
      setting('AffiliateEnabled'), setting('AffiliateEarningPercent'), setting('AffiliatePayout'),
    ]);
    if (enabled === null) throw new Error('affiliate settings unavailable');
    return { enabled: ['on', '1', 'yes', 'true'].includes(String(enabled).toLowerCase()), percent: num(percent), minPayout: num(payout) };
  });
}

/** The customer's own commission terms: their own rate if WHMCS holds one, otherwise the program default. */
function terms(row, program) {
  const amount = num(row && row.payamount);
  const type = String((row && row.paytype) || '').toLowerCase();
  if (amount > 0 && type === 'percentage') return { kind: 'percent', value: amount };
  if (amount > 0 && type.startsWith('fixed')) return { kind: 'fixed', value: amount };
  return { kind: 'percent', value: program.percent };
}

/**
 * { state, affiliate?, program? }
 *   disabled     the program is off in WHMCS
 *   inactive     the customer can activate
 *   active       affiliate record in `affiliate`
 *   unavailable  WHMCS could not answer; never offer activation on a guess
 */
async function status(clientId) {
  let program;
  try { program = await settings(); } catch (e) { return { state: 'unavailable' }; }
  if (!program.enabled) return { state: 'disabled', program };
  let res;
  try { res = await whmcs.call('GetAffiliates', { userid: clientId }); } catch (e) { return { state: 'unavailable', program }; }
  if (res && res.blocked) return { state: 'unavailable', program };
  if (res && res.result === 'success') {
    const row = arr(res.affiliates && res.affiliates.affiliate).find((r) => String(r.clientid) === String(clientId));
    if (row) {
      return {
        state: 'active', program,
        affiliate: {
          id: String(row.id), clicks: num(row.visitors), balance: num(row.balance), paidOut: num(row.withdrawn),
          since: row.date || '', terms: terms(row, program),
        },
      };
    }
    return { state: 'inactive', program };
  }
  if (res && NOT_AN_AFFILIATE.test(String(res.message || ''))) return { state: 'inactive', program };
  return { state: 'unavailable', program };
}

/** Activates the signed-in customer. Returns { ok, message }. Only call for state 'inactive'. */
async function activate(clientId) {
  const res = await whmcs.call('AffiliateActivate', { userid: clientId });
  if (res && res.blocked) return { ok: false, message: 'blocked' };
  return { ok: Boolean(res && res.result === 'success'), message: String((res && res.message) || '') };
}

module.exports = { status, activate, settings, terms };
