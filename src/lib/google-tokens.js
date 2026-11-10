'use strict';

/** Per-client Google OAuth2 token store (JSON file, mirrors data/avatars.json pattern). */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'google-tokens.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function write(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  /** Returns { [tool]: { access_token, refresh_token, expires_in, obtained_at } } or null. */
  get(clientId) { const d = read(); return d[String(clientId)] || null; },
  /** Upsert tokens for a client + tool. */
  set(clientId, tool, token) { const d = read(); d[String(clientId)] = d[String(clientId)] || {}; d[String(clientId)][tool] = token; write(d); },
  /** Remove a tool's tokens for a client. */
  del(clientId, tool) { const d = read(); if (d[String(clientId)]) { delete d[String(clientId)][tool]; write(d); } },
  /** Returns list of connected tool names for a client. */
  tools(clientId) { const d = read(); return Object.keys(d[String(clientId)] || {}); },
};
