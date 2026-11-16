const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-google-test-'));
process.env.GOOGLE_TOKENS_FILE = path.join(dir, 'legacy.json');
process.env.GOOGLE_TOKENS_DB = path.join(dir, 'connections.sqlite');
const gtokens = require('../../src/lib/google-tokens');
const FILE = process.env.GOOGLE_TOKENS_DB;
beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('persistent Google connections', () => {
  test('empty store returns no connections', () => {
    expect(gtokens.get('c1')).toBeNull();
    expect(gtokens.tools('c1')).toEqual([]);
  });
  test('round trip and per-account isolation', () => {
    gtokens.set('c1', 'analytics', { access_token: 'fixture-a' });
    gtokens.set('c1', 'searchconsole', { access_token: 'fixture-b' });
    gtokens.set('c2', 'analytics', { access_token: 'fixture-c' });
    expect(gtokens.tools('c1')).toEqual(['analytics', 'searchconsole']);
    gtokens.del('c1', 'analytics');
    expect(gtokens.tools('c1')).toEqual(['searchconsole']);
    expect(gtokens.get('c2').analytics.access_token).toBe('fixture-c');
    gtokens.del('c1', 'searchconsole');
    expect(gtokens.get('c1')).toBeNull();
  });
  test('refresh token survives an access-token update without a new refresh token', () => {
    gtokens.set('c1', 'analytics', { refresh_token: 'fixture-refresh', access_token: 'fixture-old' });
    gtokens.set('c1', 'analytics', { access_token: 'fixture-new', refresh_token: undefined });
    expect(gtokens.get('c1').analytics.refresh_token).toBe('fixture-refresh');
  });
  test('migrates JSON once and does not resurrect a disconnected connection', () => {
    fs.writeFileSync(process.env.GOOGLE_TOKENS_FILE, JSON.stringify({ c1: { analytics: { access_token: 'fixture-legacy' } } }));
    expect(gtokens.get('c1').analytics.access_token).toBe('fixture-legacy');
    gtokens.del('c1', 'analytics');
    expect(gtokens.get('c1')).toBeNull();
    expect(fs.existsSync(process.env.GOOGLE_TOKENS_FILE)).toBe(true);
  });
  test('survives a new Node process and restricts database file permissions', () => {
    gtokens.set('c1', 'analytics', { access_token: 'fixture-persisted' });
    const output = execFileSync(process.execPath, ['-e', `const store = require(${JSON.stringify(path.resolve(__dirname, '../../src/lib/google-tokens'))}); process.stdout.write(JSON.stringify(store.tools('c1')));`], { env: process.env }).toString();
    expect(JSON.parse(output)).toEqual(['analytics']);
    expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
  });
  test('a corrupt legacy file fails explicitly without marking migration complete', () => {
    fs.writeFileSync(process.env.GOOGLE_TOKENS_FILE, '{broken');
    expect(() => gtokens.get('c1')).toThrow();
    fs.writeFileSync(process.env.GOOGLE_TOKENS_FILE, '{}');
    expect(gtokens.get('c1')).toBeNull();
  });
});
