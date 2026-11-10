process.env.GOOGLE_TOKENS_FILE = require('path').join(
  __dirname, '..', '..', 'data', 'test-google-tokens.json'
);
const fs = require('fs');
const path = require('path');
const gtokens = require('../../src/lib/google-tokens');

const FILE = process.env.GOOGLE_TOKENS_FILE;

beforeEach(() => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  try { fs.unlinkSync(FILE); } catch { /* ignore */ }
});
afterAll(() => {
  try { fs.unlinkSync(FILE); } catch { /* ignore */ }
});

describe('google-tokens', () => {
  test('get returns null for empty store', () => {
    expect(gtokens.get('c1')).toBeNull();
    expect(gtokens.tools('c1')).toEqual([]);
  });

  test('set/get/del/tools round trip', () => {
    const token = { access_token: 'at', refresh_token: 'rt', expires_in: 3600, obtained_at: Date.now() };
    gtokens.set('c1', 'analytics', token);
    expect(gtokens.get('c1')).toEqual({ analytics: token });
    expect(gtokens.tools('c1')).toEqual(['analytics']);

    gtokens.set('c1', 'searchconsole', { access_token: 'at2', expires_in: 3600, obtained_at: Date.now() });
    expect(gtokens.tools('c1').sort()).toEqual(['analytics', 'searchconsole']);

    gtokens.del('c1', 'analytics');
    expect(gtokens.tools('c1')).toEqual(['searchconsole']);
    expect(gtokens.get('c1')).toEqual({ searchconsole: expect.objectContaining({ access_token: 'at2' }) });

    gtokens.del('c1', 'searchconsole');
    expect(gtokens.get('c1')).toEqual({});
    expect(gtokens.tools('c1')).toEqual([]);
  });

  test('set is isolated per client', () => {
    gtokens.set('c1', 'analytics', { access_token: 'a1', expires_in: 3600, obtained_at: Date.now() });
    gtokens.set('c2', 'analytics', { access_token: 'a2', expires_in: 3600, obtained_at: Date.now() });
    expect(gtokens.get('c1').analytics.access_token).toBe('a1');
    expect(gtokens.get('c2').analytics.access_token).toBe('a2');
  });
});
