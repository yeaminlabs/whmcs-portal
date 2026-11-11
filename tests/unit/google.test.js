jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../src/lib/google-tokens', () => ({
  get: jest.fn(),
  del: jest.fn(),
  tools: jest.fn(),
}));
const axios = require('axios');
const gtokens = require('../../src/lib/google-tokens');
const router = require('../../src/routes/google');

function handlerFor(path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      const stack = layer.route.stack;
      return stack[stack.length - 1].handle;
    }
  }
  return null;
}

function mockRes() {
  const res = {};
  res.json = jest.fn((x) => { res._json = x; return res; });
  res.status = jest.fn((c) => { res._status = c; return res; });
  res.redirect = jest.fn((u) => { res._redirect = u; return res; });
  res.render = jest.fn((v, d) => { res._view = v; res._data = d; return res; });
  return res;
}

const req = (overrides = {}) => ({
  session: { clientId: 'c1' },
  params: {},
  query: {},
  ...overrides,
});

describe('google routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('connect redirects to Google consent with readonly scopes', () => {
    const h = handlerFor('/connect/:tool');
    const r = req({ params: { tool: 'analytics' } });
    const res = mockRes();
    h(r, res);
    expect(res._redirect).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(res._redirect).toContain('analytics.readonly');
    expect(res._redirect).toContain('webmasters.readonly');
    expect(res._redirect).toContain('access_type=offline');
    expect(res._redirect).toContain('prompt=consent');
  });

  test('connect rejects unknown tool', () => {
    const h = handlerFor('/connect/:tool');
    const r = req({ params: { tool: 'bogus' } });
    const res = mockRes();
    h(r, res);
    expect(res._status).toBe(400);
    expect(res._view).toBe('error');
  });

  test('data route 409 when not connected', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue(null);
    const r = req({ params: { tool: 'analytics' } });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(409);
    expect(res._json.error).toBe('not_connected');
  });

  test('data route 409 when token expired', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ analytics: { access_token: 'tok', obtained_at: 0, expires_in: 3600 } });
    const r = req({ params: { tool: 'analytics' } });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(409);
    expect(res._json.error).toBe('expired');
  });

  test('data route auto-discovers GA4 property when no viewId provided', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ analytics: { access_token: 'tok', obtained_at: Date.now(), expires_in: 3600 } });
    axios.get
      .mockResolvedValueOnce({ data: { accounts: [{ name: 'accounts/999', displayName: 'Test' }] } })
      .mockResolvedValueOnce({ data: { properties: [{ name: 'properties/777' }] } });
    axios.post.mockResolvedValue({ data: { rowCount: 3 } });
    const r = req({ params: { tool: 'analytics' }, query: {} });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(undefined);
    expect(res._json).toEqual({ rowCount: 3 });
    const [url] = axios.post.mock.calls[0];
    expect(url).toContain('777:runReport');
  });

  test('data route 409 when no GA4 accounts found', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ analytics: { access_token: 'tok', obtained_at: Date.now(), expires_in: 3600 } });
    axios.get.mockResolvedValueOnce({ data: { accounts: [] } });
    const r = req({ params: { tool: 'analytics' }, query: {} });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(409);
    expect(res._json.error).toBe('no_ga4_account');
  });

  test('data route fetches analytics read-only report with explicit viewId', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ analytics: { access_token: 'tok', obtained_at: Date.now(), expires_in: 3600 } });
    axios.post.mockResolvedValue({ data: { reports: [{ data: { totals: [] } }] } });
    const r = req({ params: { tool: 'analytics' }, query: { viewId: '123' } });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(undefined);
    expect(res._json).toEqual({ reports: [{ data: { totals: [] } }] });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toContain('analyticsdata.googleapis.com');
    expect(url).toContain('123:runReport');
    expect(body.metrics[0].name).toBe('sessions');
    expect(cfg.headers.Authorization).toBe('Bearer tok');
  });

  test('data route fetches searchconsole read-only query with explicit siteUrl', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ searchconsole: { access_token: 'tok', obtained_at: Date.now(), expires_in: 3600 } });
    axios.post.mockResolvedValue({ data: { rows: [{ keys: ['2026-11-10'], clicks: 5, impressions: 50, ctr: 0.1, position: 3 }] } });
    const r = req({ params: { tool: 'searchconsole' }, query: { siteUrl: 'https://example.com/' } });
    const res = mockRes();
    await h(r, res);
    expect(res._json).toEqual({
      siteUrl: 'https://example.com/',
      days: 7,
      summary: { clicks: 5, impressions: 50, ctr: 0.1, position: 3 },
      series: [{ date: '2026-11-10', clicks: 5, impressions: 50 }],
    });
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toContain('webmasters/v3/sites/');
    expect(body.dimensions).toEqual(['date']);
    expect(cfg.headers.Authorization).toBe('Bearer tok');
  });

  test('data route auto-discovers Search Console site when no siteUrl provided', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ searchconsole: { access_token: 'tok', obtained_at: Date.now(), expires_in: 3600 } });
    axios.get.mockResolvedValueOnce({ data: { siteEntry: [{ siteUrl: 'https://mysite.com/', permissionLevel: 'siteOwner' }] } });
    axios.post.mockResolvedValue({ data: { rows: [{ keys: ['2026-11-10'], clicks: 5 }] } });
    const r = req({ params: { tool: 'searchconsole' }, query: {} });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(undefined);
    const [url] = axios.post.mock.calls[0];
    expect(url).toContain(encodeURIComponent('https://mysite.com/'));
  });

  test('data route 409 when no Search Console sites found', async () => {
    const h = handlerFor('/data/:tool');
    gtokens.get.mockReturnValue({ searchconsole: { access_token: 'tok', obtained_at: Date.now(), expires_in: 3600 } });
    axios.get.mockResolvedValueOnce({ data: { siteEntry: [] } });
    const r = req({ params: { tool: 'searchconsole' }, query: {} });
    const res = mockRes();
    await h(r, res);
    expect(res._status).toBe(409);
    expect(res._json.error).toBe('no_sc_site');
  });
});
