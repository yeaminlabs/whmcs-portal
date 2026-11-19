'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const session = require('express-session');

process.env.MOCK_MODE = 'true';

const TEST_DB = path.join(os.tmpdir(), `2fa-api-${process.pid}.sqlite`);
process.env.TWOFA_DB = TEST_DB;

const twofactor = require('../../src/routes/twofactor');
const totp = require('../../src/lib/totp');
const store = require('../../src/lib/twofactor-store');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const decode = (s) => {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0, out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
const hotp = (keyBuf, counter) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', keyBuf).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** 6).padStart(6, '0');
};
const currentCode = (secret, offset = 0) => hotp(decode(secret), Math.floor(Date.now() / 1000 / 30) + offset);

const app = express();
app.use(express.json());
app.use(session({ secret: 'api-test-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: false, sameSite: false, secure: false } }));
app.use((req, res, next) => { req.session.clientId = 42; req.session.clientEmail = 'api@example.com'; next(); });
app.use('/', twofactor);

let server;
beforeAll((done) => { server = app.listen(0, done); });
afterAll(() => {
  server.close(() => { /* drained */ });
  server.unref();
  try { fs.unlinkSync(TEST_DB); } catch (e) { /* ignore */ }
});

const base = () => `http://localhost:${server.address().port}`;
const request = (method, url, body, cookie) =>
  new Promise((resolve, reject) => {
    const u = new URL(url, base());
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: {} };
    if (cookie) opts.headers.Cookie = cookie;
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request(opts, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
const postJson = (url, body, cookie) => request('POST', url, JSON.stringify(body || {}), cookie);
const get = (url, cookie) => request('GET', url, null, cookie);
const parse = (r) => JSON.parse(r.body);

let sid;
const withSession = async (fn) => {
  const r = await get('/api/2fa/status');
  sid = (r.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='));
  return fn(sid);
};

beforeEach(() => {
  store.disable(42, TEST_DB);
});

describe('2FA JSON API', () => {
  test('status reports not enabled before setup', async () => {
    await withSession(async (cookie) => {
      const r = await get('/api/2fa/status', cookie);
      expect(r.status).toBe(200);
      expect(parse(r)).toEqual({ enabled: false, backupCodesLeft: 0 });
    });
  });

  test('setup returns a secret and QR data URL', async () => {
    await withSession(async (cookie) => {
      const r = await postJson('/api/2fa/setup', null, cookie);
      expect(r.status).toBe(200);
      const d = parse(r);
      expect(typeof d.secret).toBe('string');
      expect(d.secret.length).toBeGreaterThan(0);
      expect(typeof d.qr).toBe('string');
      expect(d.qr.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  test('setup/confirm accepts a valid TOTP code and returns backup codes', async () => {
    await withSession(async (cookie) => {
      const secret = parse(await postJson('/api/2fa/setup', null, cookie)).secret;

      const wrong = await postJson('/api/2fa/setup/confirm', { code: '000000' }, cookie);
      expect(wrong.status).toBe(422);

      const confirm = await postJson('/api/2fa/setup/confirm', { code: currentCode(secret) }, cookie);
      expect(confirm.status).toBe(200);
      const cd = parse(confirm);
      expect(Array.isArray(cd.codes)).toBe(true);
      expect(cd.codes.length).toBe(10);

      const st = await get('/api/2fa/status', cookie);
      expect(parse(st)).toEqual({ enabled: true, backupCodesLeft: 10 });
    });
  });

  test('remove disables 2FA with a valid code and rejects wrong codes', async () => {
    await withSession(async (cookie) => {
      const secret = parse(await postJson('/api/2fa/setup', null, cookie)).secret;
      await postJson('/api/2fa/setup/confirm', { code: currentCode(secret) }, cookie);

      const bad = await postJson('/api/2fa/remove', { code: '000000' }, cookie);
      expect(bad.status).toBe(422);

      const rem = await postJson('/api/2fa/remove', { code: currentCode(secret, 1) }, cookie);
      expect(rem.status).toBe(200);
      expect(parse(rem)).toEqual({ ok: true });

      const st = await get('/api/2fa/status', cookie);
      expect(parse(st)).toEqual({ enabled: false, backupCodesLeft: 0 });
    });
  });
});
