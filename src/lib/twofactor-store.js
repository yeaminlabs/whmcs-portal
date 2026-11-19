'use strict';

/**
 * Per-client two-factor settings, kept in the portal's own database (not WHMCS).
 * TOTP secrets are encrypted at rest with AES-256-GCM; backup codes are stored as scrypt hashes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('../config');
const totp = require('./totp');

const DEFAULT_FILE = process.env.TWOFA_DB || path.join(__dirname, '..', '..', 'data', 'twofactor.sqlite');
let db = null;
let dbFile = null;

function open(file = DEFAULT_FILE) {
  if (db && dbFile === file) return db;
  if (db) db.close();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  db = new Database(file, { timeout: 5000 });
  dbFile = file;
  try { fs.chmodSync(file, 0o600); } catch (e) { /* best effort */ }
  db.exec(`CREATE TABLE IF NOT EXISTS twofactor (
    client_id INTEGER PRIMARY KEY,
    secret_enc TEXT NOT NULL,
    backup_hashes TEXT NOT NULL,
    last_step INTEGER NOT NULL DEFAULT -1,
    enabled_at INTEGER NOT NULL
  )`);
  return db;
}

/** Key for at-rest encryption, derived from the session secret. */
function key() {
  return crypto.createHash('sha256').update('portal-2fa:' + config.sessionSecret).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(blob) {
  const [iv, tag, data] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function row(clientId, file) {
  return open(file).prepare('SELECT * FROM twofactor WHERE client_id = ?').get(Number(clientId)) || null;
}

const isEnabled = (clientId, file) => Boolean(row(clientId, file));

/** `{ enabled, backupCodesLeft }` for display. */
function status(clientId, file) {
  const r = row(clientId, file);
  return r ? { enabled: true, backupCodesLeft: JSON.parse(r.backup_hashes).length } : { enabled: false, backupCodesLeft: 0 };
}

/** Turns on 2FA for a client, replacing any earlier setup. */
function enable(clientId, secret, backupCodes, file) {
  const hashes = backupCodes.map(totp.hashBackupCode);
  open(file).prepare(`INSERT OR REPLACE INTO twofactor (client_id, secret_enc, backup_hashes, last_step, enabled_at)
    VALUES (?, ?, ?, -1, ?)`).run(Number(clientId), encrypt(secret), JSON.stringify(hashes), Date.now());
}

function disable(clientId, file) {
  open(file).prepare('DELETE FROM twofactor WHERE client_id = ?').run(Number(clientId));
}

/**
 * Accepts a TOTP code once. Returns true when it matches a time step newer than the
 * last accepted one (so a code cannot be replayed), and records that step.
 */
function acceptTotp(clientId, code, file, now = Date.now()) {
  const r = row(clientId, file);
  if (!r) return false;
  const step = totp.verify(decrypt(r.secret_enc), code, { now });
  if (step < 0 || step <= r.last_step) return false;
  open(file).prepare('UPDATE twofactor SET last_step = ? WHERE client_id = ?').run(step, Number(clientId));
  return true;
}

/** Uses one recovery code, removing it so it cannot be used again. */
function acceptBackup(clientId, code, file) {
  const r = row(clientId, file);
  if (!r) return false;
  const hashes = JSON.parse(r.backup_hashes);
  const idx = hashes.findIndex((h) => totp.checkBackupCode(code, h));
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  open(file).prepare('UPDATE twofactor SET backup_hashes = ? WHERE client_id = ?').run(JSON.stringify(hashes), Number(clientId));
  return true;
}

/** Returns the decrypted secret for a client during setup or tests. Null when 2FA is off. */
function secretFor(clientId, file) {
  const r = row(clientId, file);
  return r ? decrypt(r.secret_enc) : null;
}

module.exports = { isEnabled, status, enable, disable, acceptTotp, acceptBackup, secretFor, open };
