'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'reset-tokens.json');
const TTL_MS = 60 * 60 * 1000; // 1 hour

function read(file = DATA_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}
function write(obj, file = DATA_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function prune(obj) {
  const now = Date.now();
  for (const [k, v] of Object.entries(obj)) {
    if (v.used || v.expiresAt < now) delete obj[k];
  }
  return obj;
}

/** Creates a single-use reset token for `clientId`. Returns the token string. */
function create(email, clientId, file = DATA_FILE) {
  const obj = prune(read(file));
  const token = crypto.randomBytes(32).toString('hex');
  obj[token] = { email, clientId: Number(clientId), createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, used: false };
  write(obj, file);
  return token;
}

/** Returns the token's entry when it exists, is unused and not yet expired. No mutation. */
function valid(token, file = DATA_FILE) {
  const obj = prune(read(file));
  const entry = obj[token];
  if (!entry || entry.used || entry.expiresAt < Date.now()) return null;
  return entry;
}

/** Marks `token` used so it cannot be reused. Returns the entry or null. */
function consume(token, file = DATA_FILE) {
  const obj = prune(read(file));
  const entry = obj[token];
  if (!entry || entry.used || entry.expiresAt < Date.now()) return null;
  entry.used = true;
  write(obj, file);
  return { email: entry.email, clientId: entry.clientId };
}

module.exports = { create, valid, consume, DATA_FILE, TTL_MS };
