'use strict';

/**
 * Remembers each client's Google profile photo (keyed by WHMCS client id) so it
 * still shows after an email/password login. Stored as a small JSON file.
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.AVATAR_STORE || path.join(__dirname, '..', '..', 'data', 'avatars.json');
let map = null;

function load() {
  if (map) return map;
  try {
    map = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
  } catch (e) {
    map = {};
  }
  return map;
}

function get(clientId) {
  return load()[String(clientId)] || null;
}

function set(clientId, url) {
  if (!clientId || !url) return;
  const m = load();
  if (m[String(clientId)] === url) return;
  m[String(clientId)] = url;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.warn('[avatars] could not save:', e.message);
  }
}

module.exports = { get, set };
