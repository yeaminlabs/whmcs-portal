const fs = require('fs');
const os = require('os');
const path = require('path');
const { create, valid, consume, TTL_MS } = require('../../src/lib/reset-tokens');

const FILE = path.join(os.tmpdir(), `snbd-reset-test-${process.pid}.json`);

beforeEach(() => {
  try { fs.unlinkSync(FILE); } catch (e) { /* ignore */ }
});
afterAll(() => {
  try { fs.unlinkSync(FILE); } catch (e) { /* ignore */ }
});

describe('reset-tokens', () => {
  test('create returns a hex token and valid() reads it back', () => {
    const token = create('demo@example.com', 1, FILE);
    expect(typeof token).toBe('string');
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    const entry = valid(token, FILE);
    expect(entry).toEqual({ email: 'demo@example.com', clientId: 1, used: false, createdAt: expect.any(Number), expiresAt: expect.any(Number) });
    expect(entry.expiresAt - entry.createdAt).toBe(TTL_MS);
  });

  test('consume marks token used and valid() then returns null', () => {
    const token = create('demo@example.com', 1, FILE);
    const consumed = consume(token, FILE);
    expect(consumed).toEqual({ email: 'demo@example.com', clientId: 1 });
    expect(valid(token, FILE)).toBeNull();
  });

  test('a consumed token cannot be reused', () => {
    const token = create('demo@example.com', 1, FILE);
    consume(token, FILE);
    expect(consume(token, FILE)).toBeNull();
  });

  test('unknown token is invalid', () => {
    expect(valid('deadbeef'.repeat(8), FILE)).toBeNull();
    expect(consume('deadbeef'.repeat(8), FILE)).toBeNull();
  });

  test('expired token is invalid and pruned', () => {
    const token = create('demo@example.com', 1, FILE);
    // Force expiry by rewriting the store with a past expiresAt.
    const obj = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    obj[token].expiresAt = Date.now() - 1000;
    fs.writeFileSync(FILE, JSON.stringify(obj));
    expect(valid(token, FILE)).toBeNull();
  });
});
