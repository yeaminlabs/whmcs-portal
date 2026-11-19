'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const totp = require('../../src/lib/totp');
const store = require('../../src/lib/twofactor-store');

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 SHA-1 reference secret "12345678901234567890", 8-digit value 94287082 at T=59 -> 6 digits 287082.
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));

  test('base32 round-trips', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(totp.base32Decode(totp.base32Encode(buf)).equals(buf)).toBe(true);
  });

  test('matches the RFC vector at T=59 and reports the step', () => {
    expect(totp.verify(secret, '287082', { now: 59 * 1000, window: 0 })).toBe(1);
  });

  test('accepts one step of clock drift and rejects wrong codes', () => {
    expect(totp.verify(secret, '287082', { now: 89 * 1000, window: 1 })).toBe(1);
    expect(totp.verify(secret, '287082', { now: 200 * 1000, window: 1 })).toBe(-1);
    expect(totp.verify(secret, '00000x', { now: 59 * 1000 })).toBe(-1);
  });

  test('otpauth URI carries the secret and issuer', () => {
    const uri = totp.otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'a@example.com', issuer: 'SNBD HOST' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=SNBD+HOST');
  });

  test('backup codes hash, verify once per code and normalise case and dashes', () => {
    const [code] = totp.generateBackupCodes(1);
    expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    const stored = totp.hashBackupCode(code);
    expect(stored).not.toContain(code.replace('-', ''));
    expect(totp.checkBackupCode(code.toUpperCase(), stored)).toBe(true);
    expect(totp.checkBackupCode('zzzz-zzzz', stored)).toBe(false);
  });
});

describe('two-factor store', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), '2fa-'));
    file = path.join(dir, 'twofactor.sqlite');
  });
  afterEach(() => {
    store.open(path.join(dir, 'close-only.sqlite')); // release the previous handle
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('enable stores an encrypted secret and status reports backup codes', () => {
    const secret = totp.generateSecret();
    const codes = totp.generateBackupCodes(3);
    expect(store.isEnabled(7, file)).toBe(false);
    store.enable(7, secret, codes, file);
    expect(store.isEnabled(7, file)).toBe(true);
    expect(store.status(7, file)).toEqual({ enabled: true, backupCodesLeft: 3 });
    expect(store.secretFor(7, file)).toBe(secret);
    const raw = fs.readFileSync(file);
    expect(raw.includes(Buffer.from(secret))).toBe(false);
  });

  test('a TOTP code is accepted once (no replay)', () => {
    const secret = totp.generateSecret();
    store.enable(8, secret, totp.generateBackupCodes(1), file);
    const now = Date.now();
    const code = totp.code(secret, totp.stepAt(now));
    expect(store.acceptTotp(8, code, file, now)).toBe(true);
    expect(store.acceptTotp(8, code, file, now)).toBe(false);
  });

  test('a backup code is consumed after one use', () => {
    const codes = ['abcd-efgh', 'jkmn-pqrs'];
    store.enable(9, totp.generateSecret(), codes, file);
    expect(store.acceptBackup(9, 'abcd-efgh', file)).toBe(true);
    expect(store.acceptBackup(9, 'abcd-efgh', file)).toBe(false);
    expect(store.status(9, file).backupCodesLeft).toBe(1);
  });

  test('disable removes the setup and rejects codes for unknown clients', () => {
    store.enable(10, totp.generateSecret(), ['abcd-efgh'], file);
    store.disable(10, file);
    expect(store.isEnabled(10, file)).toBe(false);
    expect(store.acceptBackup(10, 'abcd-efgh', file)).toBe(false);
  });
});
