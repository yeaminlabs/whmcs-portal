'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_FILE = process.env.UPTIME_DB || path.join(__dirname, '..', '..', 'data', 'uptime.sqlite');

let db = null;

function getDb() {
  if (db) return db;
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS uptime_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      interval_sec INTEGER NOT NULL DEFAULT 300,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_checked INTEGER,
      last_ms INTEGER,
      last_code INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_um_client ON uptime_monitors(client_id);
    CREATE TABLE IF NOT EXISTS uptime_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      ms INTEGER,
      code INTEGER,
      error TEXT,
      checked_at INTEGER NOT NULL,
      FOREIGN KEY (monitor_id) REFERENCES uptime_monitors(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_uc_monitor ON uptime_checks(monitor_id, checked_at);
  `);
  return db;
}

function init() { getDb(); }

function listByClient(clientId) {
  const d = getDb();
  return d.prepare('SELECT * FROM uptime_monitors WHERE client_id = ? ORDER BY id DESC').all(Number(clientId));
}

function get(id, clientId) {
  const d = getDb();
  return d.prepare('SELECT * FROM uptime_monitors WHERE id = ? AND client_id = ?').get(Number(id), Number(clientId));
}

function add(clientId, { name, url, interval }) {
  const d = getDb();
  const iv = Math.max(60, Math.min(3600, Number(interval) || 300));
  const info = d.prepare('INSERT INTO uptime_monitors (client_id, name, url, interval_sec, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(Number(clientId), String(name).slice(0, 120), String(url).slice(0, 500), iv, Date.now());
  return info.lastInsertRowid;
}

function remove(id, clientId) {
  const d = getDb();
  d.prepare('DELETE FROM uptime_checks WHERE monitor_id = ?').run(Number(id));
  return d.prepare('DELETE FROM uptime_monitors WHERE id = ? AND client_id = ?').run(Number(id), Number(clientId)).changes;
}

function dueMonitors(now) {
  const d = getDb();
  const t = now || Date.now();
  return d.prepare('SELECT * FROM uptime_monitors WHERE enabled = 1').all().filter((m) => {
    if (!m.last_checked) return true;
    return (t - m.last_checked) >= (m.interval_sec * 1000);
  });
}

function recordCheck(monitorId, result) {
  const d = getDb();
  const now = Date.now();
  d.prepare('INSERT INTO uptime_checks (monitor_id, status, ms, code, error, checked_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Number(monitorId), result.status, result.ms || null, result.code || null, result.error || null, now);
  d.prepare('UPDATE uptime_monitors SET last_status = ?, last_checked = ?, last_ms = ?, last_code = ?, last_error = ? WHERE id = ?')
    .run(result.status, now, result.ms || null, result.code || null, result.error || null, Number(monitorId));
  // prune to last 100
  d.prepare('DELETE FROM uptime_checks WHERE monitor_id = ? AND id NOT IN (SELECT id FROM uptime_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100)').run(Number(monitorId), Number(monitorId));
}

// Returns { flipped: bool, alert: bool, monitor } — alert on a transition or first confirmed down.
function recordCheckDetectFlip(monitorId, result) {
  const d = getDb();
  const before = d.prepare('SELECT last_status FROM uptime_monitors WHERE id = ?').get(Number(monitorId));
  const prevStatus = before ? before.last_status : 'unknown';
  recordCheck(monitorId, result);
  const flipped = prevStatus !== 'unknown' && prevStatus !== result.status;
  const alert = flipped || (prevStatus === 'unknown' && result.status === 'down');
  const monitor = d.prepare('SELECT * FROM uptime_monitors WHERE id = ?').get(Number(monitorId));
  return { flipped, alert, monitor };
}

function recentChecks(monitorId, limit) {
  const d = getDb();
  return d.prepare('SELECT * FROM uptime_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?').all(Number(monitorId), Number(limit) || 50);
}

function uptimePercent(monitorId, hours) {
  const d = getDb();
  const since = Date.now() - (hours || 24) * 3600 * 1000;
  const rows = d.prepare('SELECT status FROM uptime_checks WHERE monitor_id = ? AND checked_at >= ?').all(Number(monitorId), since);
  if (!rows.length) return null;
  const up = rows.filter((r) => r.status === 'up').length;
  return Math.round((up / rows.length) * 100);
}

module.exports = { init, listByClient, get, add, remove, dueMonitors, recordCheck, recordCheckDetectFlip, recentChecks, uptimePercent, DB_FILE };
