'use strict';

/** RFC 6238 time-based one-time passwords (Google Authenticator compatible), no external deps. */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit shared secret, base32 encoded for authenticator apps. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(keyBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', keyBuf).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

/** The 6-digit code for a given time step (used by tests and for diagnostics). */
function code(secret, step) {
  return hotp(base32Decode(secret), step);
}

/** The time step (counter) for a timestamp in milliseconds. */
const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a 6-digit code against the secret within +/- `window` steps.
 * Returns the matched step number, or -1. Callers reject steps <= the last used step (replay).
 */
function verify(secret, code, { now = Date.now(), window = 1 } = {}) {
  const given = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(given)) return -1;
  const key = base32Decode(secret);
  if (!key.length) return -1;
  const current = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (step < 0) continue;
    if (constantTimeEqual(hotp(key, step), given)) return step;
  }
  return -1;
}

function constantTimeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** otpauth:// URI that authenticator apps read from a QR code. */
function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten single-use recovery codes in the form xxxx-xxxx (no ambiguous characters). */
function generateBackupCodes(count = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const pick = () => Array.from(crypto.randomBytes(4), (b) => chars[b % chars.length]).join('');
    return `${pick()}-${pick()}`;
  });
}

const normalizeBackup = (code) => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Salted scrypt hash of a backup code, so stored codes cannot be read back. */
function hashBackupCode(code) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizeBackup(code), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function checkBackupCode(code, stored) {
  const normalized = normalizeBackup(code);
  if (normalized.length !== 8) return false;
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(normalized, Buffer.from(saltHex, 'hex'), 32);
  return constantTimeEqual(hash.toString('hex'), hashHex);
}

module.exports = {
  generateSecret, verify, code, otpauthUri, stepAt, base32Encode, base32Decode,
  generateBackupCodes, hashBackupCode, checkBackupCode, normalizeBackup,
  STEP_SECONDS, DIGITS,
};
