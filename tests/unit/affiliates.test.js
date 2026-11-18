jest.mock('../../src/lib/whmcs', () => ({ call: jest.fn(), assertSuccess: (d) => d, isBlocked: () => false }));
const whmcs = require('../../src/lib/whmcs');
const { invalidate } = require('../../src/lib/cache');
const affiliates = require('../../src/lib/affiliates');

const ok = (extra) => ({ result: 'success', ...extra });
const settingsOn = (name) => ({ AffiliateEnabled: ok({ value: 'on' }), AffiliateEarningPercent: ok({ value: '10' }), AffiliatePayout: ok({ value: '500.00' }) }[name]);

function mockWhmcs({ settings = settingsOn, getAffiliates, activate } = {}) {
  whmcs.call.mockImplementation(async (action, params) => {
    if (action === 'GetConfigurationValue') return settings(params.setting);
    if (action === 'GetAffiliates') return getAffiliates(params);
    if (action === 'AffiliateActivate') return activate(params);
    throw new Error(`unexpected ${action}`);
  });
}

beforeEach(() => { invalidate('affiliates:*'); whmcs.call.mockReset(); });

describe('affiliate status from WHMCS', () => {
  test('an affiliate sees their own figures and the program terms', async () => {
    mockWhmcs({ getAffiliates: () => ok({ affiliates: { affiliate: [{ id: 7, clientid: 42, visitors: 12, balance: '620.50', withdrawn: '100.00', paytype: '', payamount: '0.00', date: '2026-01-02' }] } }) });
    const s = await affiliates.status(42);
    expect(s.state).toBe('active');
    expect(s.affiliate).toMatchObject({ id: '7', clicks: 12, balance: 620.5, paidOut: 100, terms: { kind: 'percent', value: 10 } });
    expect(s.program).toEqual({ enabled: true, percent: 10, minPayout: 500 });
  });

  test('asks WHMCS with userid, the filter it honours', async () => {
    mockWhmcs({ getAffiliates: () => ({ result: 'error', message: 'Client ID not found' }) });
    await affiliates.status(42);
    expect(whmcs.call).toHaveBeenCalledWith('GetAffiliates', { userid: 42 });
  });

  test('never shows another affiliate: rows for other clients are ignored even if WHMCS returns them all', async () => {
    mockWhmcs({ getAffiliates: () => ok({ affiliates: { affiliate: [
      { id: 1, clientid: 850, visitors: 2014, balance: '487.71', withdrawn: '7954.35' },
      { id: 2, clientid: 13, visitors: 0, balance: '0.00', withdrawn: '0.00' },
    ] } }) });
    const s = await affiliates.status(42);
    expect(s.state).toBe('inactive');
    expect(s.affiliate).toBeUndefined();
  });

  test('a customer who is not an affiliate yet can activate', async () => {
    mockWhmcs({ getAffiliates: () => ({ result: 'error', message: 'Client ID not found' }) });
    expect((await affiliates.status(42)).state).toBe('inactive');
  });

  test('any other WHMCS failure is "unavailable", never an offer to activate', async () => {
    mockWhmcs({ getAffiliates: () => ({ result: 'error', message: 'Something broke' }) });
    expect((await affiliates.status(42)).state).toBe('unavailable');
    invalidate('affiliates:*');
    mockWhmcs({ getAffiliates: () => ({ result: 'error', blocked: true, message: 'API action not permitted' }) });
    expect((await affiliates.status(42)).state).toBe('unavailable');
    invalidate('affiliates:*');
    mockWhmcs({ getAffiliates: () => { throw new Error('network'); } });
    expect((await affiliates.status(42)).state).toBe('unavailable');
  });

  test('a program switched off in WHMCS is reported as disabled', async () => {
    mockWhmcs({ settings: (n) => (n === 'AffiliateEnabled' ? ok({ value: '' }) : ok({ value: '0' })), getAffiliates: () => { throw new Error('should not be asked'); } });
    expect((await affiliates.status(42)).state).toBe('disabled');
  });

  test('unreadable settings make the page unavailable, not open', async () => {
    mockWhmcs({ settings: () => ({ result: 'error', message: 'nope' }), getAffiliates: () => ok({ affiliates: { affiliate: [] } }) });
    expect((await affiliates.status(42)).state).toBe('unavailable');
  });
});

describe('activation and terms', () => {
  test('activate calls AffiliateActivate for the given client only', async () => {
    mockWhmcs({ activate: () => ok({ affiliateid: 9 }) });
    expect(await affiliates.activate(42)).toEqual({ ok: true, message: '' });
    expect(whmcs.call).toHaveBeenCalledWith('AffiliateActivate', { userid: 42 });
  });
  test('a failed or blocked activation is reported, not swallowed', async () => {
    mockWhmcs({ activate: () => ({ result: 'error', message: 'Nope' }) });
    expect((await affiliates.activate(42)).ok).toBe(false);
    mockWhmcs({ activate: () => ({ result: 'error', blocked: true }) });
    expect((await affiliates.activate(42)).ok).toBe(false);
  });
  test('commission terms use the affiliate\'s own rate when WHMCS holds one', () => {
    const program = { percent: 10 };
    expect(affiliates.terms({ paytype: '', payamount: '0.00' }, program)).toEqual({ kind: 'percent', value: 10 });
    expect(affiliates.terms({ paytype: 'percentage', payamount: '15.00' }, program)).toEqual({ kind: 'percent', value: 15 });
    expect(affiliates.terms({ paytype: 'fixed', payamount: '75.00' }, program)).toEqual({ kind: 'fixed', value: 75 });
    expect(affiliates.terms(null, program)).toEqual({ kind: 'percent', value: 10 });
  });
});
