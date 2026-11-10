'use strict';

/** Maps a WHMCS server module to the portal dashboard that renders it, plus view helpers. */
const KIND_BY_MODULE = {
  cpanel: 'hosting',
  snbd_n8n: 'n8n',
  openclaw_n8n: 'n8n',
  hermesagent: 'hermes',
  ArkHostHetznerVPS: 'vps',
  pvewhmcs: 'vps',
  puqProxmoxKVM: 'vps',
  snbdpanel: 'vps',
};
const KINDS = ['hosting', 'n8n', 'hermes', 'vps', 'generic'];

function kindOf(view) {
  if (view && KINDS.includes(view.kind)) return view.kind;
  return KIND_BY_MODULE[view && view.module] || 'generic';
}

const CPANEL_APPS = ['', 'Email_Webmail', 'Email_Accounts', 'FileManager_Home', 'Database_MySQL', 'Database_phpMyAdmin', 'Backups_Home', 'SSL_TLS_Status', 'Domains_Home', 'WordPress_Manager'];

const CONSOLE_FNS = ['VNC', 'noVNC'];

function fnIcon(fn) {
  const f = String(fn).toLowerCase();
  if (/vnc|console/.test(f)) return 'terminal';
  if (/killswitch/.test(f)) return 'power';
  if (/start/.test(f) && !/restart/.test(f)) return 'play';
  if (/stop|shutdown/.test(f)) return 'stop';
  if (/restart|reboot|redeploy|reinstall/.test(f)) return 'refresh';
  if (/log/.test(f)) return 'file';
  if (/pass|reset_users/.test(f)) return 'key';
  if (/backup/.test(f)) return 'download';
  if (/health/.test(f)) return 'activity';
  if (/upgrade/.test(f)) return 'bolt';
  if (/reset/.test(f)) return 'alert';
  return 'bolt';
}

/** "1536" (MB) -> "1.5 GB" */
function sizeMB(mb) {
  const n = Number(mb) || 0;
  if (n >= 1024 * 1024) return `${+(n / 1024 / 1024).toFixed(1)} TB`;
  if (n >= 1024) return `${+(n / 1024).toFixed(1)} GB`;
  return `${Math.round(n)} MB`;
}

function pct(used, limit) {
  const u = Number(used) || 0;
  const l = Number(limit) || 0;
  if (l <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((u / l) * 100)));
}

function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/** SVG path data for a line chart of [[ts, value], ...] inside a w x h box. */
function chart(points, w = 600, h = 140) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  if (pts.length < 2) return null;
  const xs = pts.map((p) => Number(p[0]));
  const ys = pts.map((p) => Number(p[1]));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const max = Math.max(...ys);
  const min = Math.min(...ys);
  const top = max > 0 ? max * 1.1 : 1;
  const pad = 4;
  const X = (x) => (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * w);
  const Y = (y) => pad + (h - 2 * pad) * (1 - Math.max(0, y) / top);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(Number(p[0])).toFixed(1)},${Y(Number(p[1])).toFixed(1)}`).join(' ');
  return {
    w, h, line,
    area: `${line} L${w},${h} L0,${h} Z`,
    min, max, last: ys[ys.length - 1],
    from: new Date(x0 * 1000), to: new Date(x1 * 1000),
  };
}

module.exports = { KINDS, kindOf, CPANEL_APPS, CONSOLE_FNS, fnIcon, sizeMB, pct, compact, chart };
