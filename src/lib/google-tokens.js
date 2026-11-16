'use strict';

/** Account-scoped OAuth connections, durable across sessions and server restarts. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const LEGACY = process.env.GOOGLE_TOKENS_FILE || path.join(__dirname, '..', '..', 'data', 'google-tokens.json');
const FILE = process.env.GOOGLE_TOKENS_DB || LEGACY.replace(/\.json$/, '') + '.sqlite';

function withDatabase(fn) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const db = new Database(FILE, { timeout: 5000 });
  try {
    fs.chmodSync(FILE, 0o600);
    db.exec(`CREATE TABLE IF NOT EXISTS google_connections (
      client_id TEXT NOT NULL, tool TEXT NOT NULL, token TEXT NOT NULL,
      PRIMARY KEY (client_id, tool));
      CREATE TABLE IF NOT EXISTS google_migrations (name TEXT PRIMARY KEY);`);
    db.transaction(() => {
      if (db.prepare('SELECT name FROM google_migrations WHERE name = ?').get('json-v1')) return;
      if (fs.existsSync(LEGACY)) {
        const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
        const insert = db.prepare('INSERT OR IGNORE INTO google_connections VALUES (?, ?, ?)');
        for (const [clientId, tools] of Object.entries(legacy)) {
          for (const [tool, token] of Object.entries(tools || {})) {
            if (['analytics', 'searchconsole'].includes(tool) && token && typeof token === 'object') {
              insert.run(clientId, tool, JSON.stringify(token));
            }
          }
        }
      }
      db.prepare('INSERT INTO google_migrations VALUES (?)').run('json-v1');
    })();
    return fn(db);
  } finally { db.close(); }
}

module.exports = {
  get(clientId) {
    return withDatabase(db => {
      const rows = db.prepare('SELECT tool, token FROM google_connections WHERE client_id = ?').all(String(clientId));
      return rows.length ? Object.fromEntries(rows.map(r => [r.tool, JSON.parse(r.token)])) : null;
    });
  },
  set(clientId, tool, token) {
    if (!['analytics', 'searchconsole'].includes(tool)) throw new Error('Unknown Google tool');
    return withDatabase(db => db.transaction(() => {
      const old = db.prepare('SELECT token FROM google_connections WHERE client_id = ? AND tool = ?').get(String(clientId), tool);
      const previous = old ? JSON.parse(old.token) : {};
      const merged = { ...previous, ...token, refresh_token: token.refresh_token || previous.refresh_token };
      db.prepare('INSERT INTO google_connections VALUES (?, ?, ?) ON CONFLICT(client_id, tool) DO UPDATE SET token = excluded.token')
        .run(String(clientId), tool, JSON.stringify(merged));
    })());
  },
  del(clientId, tool) {
    return withDatabase(db => db.prepare('DELETE FROM google_connections WHERE client_id = ? AND tool = ?').run(String(clientId), tool));
  },
  tools(clientId) {
    return withDatabase(db => db.prepare('SELECT tool FROM google_connections WHERE client_id = ? ORDER BY tool').all(String(clientId)).map(r => r.tool));
  },
};
