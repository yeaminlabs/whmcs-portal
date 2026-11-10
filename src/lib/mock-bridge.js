'use strict';

/**
 * Mock implementation of the bridge contract (docs/BRIDGE_CONTRACT.md) for demo mode.
 * Services are read from the mock GetClientsProducts list, so ownership follows it;
 * services 101 and 601–607 (client 1) carry module fixtures, others render as generic.
 */
const crypto = require('crypto');
const mock = require('./mock');
const { bridgeError } = require('./bridge');
const { kindOf, CPANEL_APPS } = require('./service-kinds');

const MODULE_BY_ID = {
  101: 'cpanel', 601: 'snbd_n8n', 602: 'openclaw_n8n', 603: 'hermesagent',
  604: 'ArkHostHetznerVPS', 605: 'pvewhmcs', 606: 'snbdpanel', 607: 'snbd_dns',
};

const ACTIONS = {
  snbd_n8n: [
    { fn: 'start', label: 'Start', confirm: false, danger: false },
    { fn: 'stop', label: 'Stop', confirm: true, danger: false },
    { fn: 'restart', label: 'Restart', confirm: false, danger: false },
    { fn: 'upgrade', label: 'Update n8n', confirm: true, danger: false },
    { fn: 'reset_users', label: 'Reset users', confirm: true, danger: true },
    { fn: 'reset_data', label: 'Reset all data', confirm: true, danger: true },
  ],
  openclaw_n8n: [
    { fn: 'ClientStart', label: 'Start', confirm: false, danger: false },
    { fn: 'ClientStop', label: 'Stop', confirm: true, danger: false },
    { fn: 'ClientRestart', label: 'Restart', confirm: false, danger: false },
    { fn: 'ClientReinstall', label: 'Reinstall', confirm: true, danger: true },
  ],
  hermesagent: [
    { fn: 'healthcheck', label: 'Health check', confirm: false, danger: false },
    { fn: 'restart', label: 'Restart', confirm: false, danger: false },
    { fn: 'viewlogs', label: 'View logs', confirm: false, danger: false },
    { fn: 'regenpassword', label: 'Regenerate password', confirm: false, danger: false },
    { fn: 'downloadbackup', label: 'Download backup', confirm: false, danger: false },
    { fn: 'redeploy', label: 'Redeploy', confirm: true, danger: false },
    { fn: 'killswitch', label: 'Kill switch', confirm: true, danger: true },
  ],
  ArkHostHetznerVPS: [
    { fn: 'Start', label: 'Start', confirm: false, danger: false },
    { fn: 'Reboot', label: 'Reboot', confirm: false, danger: false },
    { fn: 'Stop', label: 'Stop', confirm: true, danger: false },
    { fn: 'VNC', label: 'Console', confirm: false, danger: false },
  ],
  pvewhmcs: [
    { fn: 'vmStart', label: 'Start', confirm: false, danger: false },
    { fn: 'vmReboot', label: 'Reboot', confirm: false, danger: false },
    { fn: 'vmShutdown', label: 'Shut down', confirm: true, danger: false },
    { fn: 'vmStop', label: 'Power off', confirm: true, danger: true },
    { fn: 'noVNC', label: 'Console', confirm: false, danger: false },
  ],
  snbdpanel: [
    { fn: 'resetpassword', label: 'Reset password', confirm: false, danger: false },
  ],
};

const state = { 601: 'running', 602: 'suspended', 603: 'running', 604: 'running', 605: 'running', 606: 'running' };

function series(seed, base, amp, hours = 24) {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const out = [];
  for (let i = 0; i < hours; i += 1) {
    const v = base + amp * Math.sin((i + seed) / 3) + (amp / 2) * Math.sin((i * seed) / 5);
    out.push([now - (hours - 1 - i) * 3600, Math.max(0, Math.round(v * 10) / 10)]);
  }
  return out;
}

function panelFor(id, s) {
  switch (Number(id)) {
    case 101:
      return { cpanelUrl: 'https://usa1.snbdhost.com:2083', webmailUrl: 'https://usa1.snbdhost.com:2096' };
    case 601:
      return { url: 'https://flows-demo.n8n.snbdhost.com', state: state[601], version: '1.91.2', resources: { cpu: '1', ram: '1 GB', disk: '10 GB' }, database: 'SQLite', mode: 'Standard', workers: null };
    case 602:
      return { url: 'https://claw-demo.openclaw.snbdhost.com', state: state[602], version: '1.88.0', resources: { cpu: '2', ram: '2 GB', disk: '20 GB' }, database: 'PostgreSQL', mode: 'Queue', workers: 2 };
    case 603:
      return { state: state[603], endpoint: 'https://agent-demo.hermes.snbdhost.com/v1', dashboardUrl: 'https://agent-demo.hermes.snbdhost.com', llm: { used: 3452180, limit: 10000000, unit: 'tokens' }, brain: 'GPT-4o mini' };
    case 604:
      return {
        state: state[604], ipv4: ['5.161.42.17'], ipv6: ['2a01:4ff:f0:1a2b::1'], os: 'Ubuntu 24.04', location: 'Ashburn, VA',
        specs: { cpu: 2, ramMb: 2048, diskGb: 40 }, hostname: s.domain, consoleAvailable: true,
        graphs: [{ name: 'CPU %', points: series(2, 18, 9) }, { name: 'Network Mbps', points: series(5, 6, 4) }],
      };
    case 605:
      return {
        state: state[605], ipv4: ['103.112.52.40'], ipv6: [], os: 'Debian 12', location: 'Dhaka, BD',
        specs: { cpu: 1, ramMb: 2048, diskGb: 20 }, hostname: s.domain, consoleAvailable: true,
        graphs: [{ name: 'CPU %', points: series(3, 11, 6) }, { name: 'RAM %', points: series(7, 46, 5) }],
      };
    case 606:
      return {
        state: state[606], ipv4: ['103.112.52.77'], ipv6: [], os: 'AlmaLinux 9', location: 'Dhaka, BD',
        specs: { cpu: 2, ramMb: 4096, diskGb: 60 }, hostname: s.domain, consoleAvailable: false, graphs: [],
      };
    default:
      return {};
  }
}

async function ownedRow(clientId, serviceId) {
  if (!clientId || !serviceId) return null;
  const list = await mock.GetClientsProducts({ clientid: clientId });
  const rows = (list.products && list.products.product) || [];
  return rows.find((p) => String(p.id) === String(serviceId) && String(p.clientid) === String(clientId)) || null;
}

async function moduleOf(row) {
  if (MODULE_BY_ID[row.id]) return MODULE_BY_ID[row.id];
  const prods = await mock.GetProducts();
  const p = prods.products.product.find((x) => String(x.pid) === String(row.pid));
  return (p && p.module) || '';
}

function serviceOf(row) {
  const hosting = row.id === 101 || row.id === 501;
  return {
    id: row.id, pid: row.pid, name: row.name || '', groupname: row.groupname || '',
    domain: row.domain || '', status: row.status, billingcycle: row.billingcycle,
    recurringamount: row.recurringamount || row.amount || '0.00', nextduedate: row.nextduedate || null, regdate: row.regdate || null,
    username: row.username || '', dedicatedip: row.dedicatedip || '', assignedips: [],
    server: hosting ? { name: 'usa1', hostname: 'usa1.snbdhost.com', ip: '104.21.32.18' } : null,
    nameservers: hosting ? ['ns1.snbdhost.com', 'ns2.snbdhost.com'] : [],
    diskusage: hosting ? 412 : null, disklimit: hosting ? 1024 : null,
    bwusage: hosting ? 8360 : null, bwlimit: hosting ? 0 : null,
    lastupdate: hosting ? '2026-11-09 03:00:00' : null,
  };
}

async function view({ clientId, serviceId }) {
  const row = await ownedRow(clientId, serviceId);
  if (!row) throw bridgeError('not_found', 'Service not found');
  const module = await moduleOf(row);
  const service = serviceOf(row);
  const kind = kindOf({ module });
  const sso = module === 'cpanel'
    ? [{ app: '', label: 'cPanel' }, { app: 'Email_Webmail', label: 'Webmail' }]
    : module === 'snbdpanel' ? [{ app: '', label: 'Control panel' }] : [];
  const panel = kind === 'hosting' ? panelFor(101, service) : panelFor(row.id, service);
  return {
    service, module, kind, actions: ACTIONS[module] || [], sso, panel,
    raw: { templatefile: 'clientarea', vars: { serviceid: row.id, domain: service.domain, status: service.status } },
  };
}

const LOGS = [
  '[2026-11-09 21:14:02] INFO  hermes: agent booted (pid 1842)',
  '[2026-11-09 21:14:03] INFO  brain: model GPT-4o mini ready',
  '[2026-11-09 21:14:03] INFO  http: listening on :8080',
  '[2026-11-09 21:20:41] INFO  chat: session 7f3a opened',
  '[2026-11-09 21:20:44] INFO  tools: web.search ok (812 ms)',
  '[2026-11-09 21:21:02] WARN  llm: slow response 4.1 s, retrying stream',
  '[2026-11-09 21:21:05] INFO  chat: session 7f3a reply sent (1,204 tokens)',
  '[2026-11-09 22:00:00] INFO  backup: nightly snapshot created (38 MB)',
  '[2026-11-09 22:47:19] INFO  health: all checks passed',
].join('\n');

const genPassword = () => crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 16);

const RESULTS = {
  start: (id) => { state[id] = 'running'; return { message: 'Start command sent. The instance will be up in a few seconds.' }; },
  stop: (id) => { state[id] = 'stopped'; return { message: 'Stopped.' }; },
  restart: (id) => { state[id] = 'running'; return { message: 'Restart command sent.' }; },
  upgrade: () => ({ message: 'n8n is updating to the latest version.' }),
  reset_users: () => ({ message: 'User accounts were reset. Open n8n to create a new owner account.' }),
  reset_data: () => ({ message: 'All workflows and data were deleted.' }),
  reinstall: (id) => { state[id] = 'deploying'; return { message: 'Reinstall started. This takes about 2 minutes.' }; },
  healthcheck: () => ({ message: 'All checks passed (API, worker, database).' }),
  viewlogs: () => ({ message: 'Last 9 log lines.', data: { logs: LOGS } }),
  regenpassword: () => ({ message: 'A new password was generated.', data: { password: genPassword() } }),
  downloadbackup: () => ({ message: 'Backup is ready.', data: { file: { name: 'hermes-backup-2026-11-09.tar.gz', url: 'https://agent-demo.hermes.snbdhost.com/backups/hermes-backup-2026-11-09.tar.gz' } } }),
  redeploy: (id) => { state[id] = 'deploying'; return { message: 'Redeploy started.' }; },
  killswitch: (id) => { state[id] = 'stopped'; return { message: 'Agent stopped by the kill switch.' }; },
  console: (id) => ({ message: 'Console session created.', data: { url: `https://console.snbdhost.com/vnc.html?token=${crypto.randomBytes(8).toString('hex')}&sid=${id}` } }),
  resetpassword: () => ({ message: 'Root password was reset.', data: { password: genPassword() } }),
};
const RESULT_BY_FN = {
  start: 'start', ClientStart: 'start', Start: 'start', vmStart: 'start',
  stop: 'stop', ClientStop: 'stop', Stop: 'stop', vmShutdown: 'stop', vmStop: 'stop',
  restart: 'restart', ClientRestart: 'restart', Reboot: 'restart', vmReboot: 'restart',
  upgrade: 'upgrade', reset_users: 'reset_users', reset_data: 'reset_data', ClientReinstall: 'reinstall',
  healthcheck: 'healthcheck', viewlogs: 'viewlogs', regenpassword: 'regenpassword', downloadbackup: 'downloadbackup',
  redeploy: 'redeploy', killswitch: 'killswitch', VNC: 'console', noVNC: 'console', resetpassword: 'resetpassword',
};

async function action({ clientId, serviceId, fn, confirm }) {
  const row = await ownedRow(clientId, serviceId);
  if (!row) throw bridgeError('not_found', 'Service not found');
  if (row.status !== 'Active') throw bridgeError('not_active', 'Service is not active');
  const module = await moduleOf(row);
  if (typeof fn !== 'string' || /^Admin/.test(fn)) throw bridgeError('not_allowed', 'Function not allowed');
  const def = (ACTIONS[module] || []).find((a) => a.fn === fn);
  if (!def) throw bridgeError('not_allowed', 'Function not allowed');
  if (def.confirm && confirm !== true) throw bridgeError('confirm_required', 'This action needs confirmation');
  const out = RESULTS[RESULT_BY_FN[fn]](row.id);
  return { message: out.message, data: out.data || {} };
}

async function sso({ clientId, serviceId, app = '' }) {
  const row = await ownedRow(clientId, serviceId);
  if (!row) throw bridgeError('not_found', 'Service not found');
  if (row.status !== 'Active') throw bridgeError('not_active', 'Service is not active');
  const module = await moduleOf(row);
  const sess = `cpsess${crypto.randomBytes(5).toString('hex')}`;
  if (module === 'cpanel') {
    if (!CPANEL_APPS.includes(app)) throw bridgeError('bad_request', 'Unknown app');
    return { url: `https://usa1.snbdhost.com:2083/${sess}/login/?session=demouser:mock${app ? `&goto_app=${app}` : ''}` };
  }
  if (module === 'snbdpanel') return { url: `https://panel.snbdhost.com/sso?token=${crypto.randomBytes(12).toString('hex')}` };
  throw bridgeError('not_allowed', 'Single sign-on is not available for this service');
}

async function whmcsSso({ clientId, path }) {
  if (!clientId) throw bridgeError('bad_request', 'clientId is required');
  if (typeof path !== 'string' || !/^(clientarea|viewinvoice)\.php/.test(path)) throw bridgeError('bad_request', 'Path not allowed');
  return { url: `https://portal.snbdhost.com/oauth/singlesignon.php?access_token=mock${crypto.randomBytes(8).toString('hex')}&redirect=${encodeURIComponent(path)}` };
}

const GLOBAL = new Set(['GetAnnouncements', 'GetKBArticles', 'GetSupportDepartments', 'GetPaymentMethods', 'GetCurrencies', 'GetProducts', 'GetTLDPricing', 'GetServers']);
const SCOPED = new Set(['GetClientsDetails', 'GetClientsProducts', 'GetClientsDomains', 'GetClientsAddons', 'GetInvoices', 'GetInvoice', 'GetSupportTickets', 'GetSupportTicket', 'GetTicketNotes', 'GetQuotes', 'GetEmails', 'GetContacts', 'GetTransactions', 'GetOrders', 'GetCredits']);

async function batch({ clientId, calls }) {
  if (!clientId || !Array.isArray(calls) || calls.length > 12) throw bridgeError('bad_request', 'Invalid batch');
  const out = {};
  await Promise.all(calls.map(async (c) => {
    const key = String(c && c.key);
    const act = c && c.action;
    if (!GLOBAL.has(act) && !SCOPED.has(act)) { out[key] = { result: 'error', message: 'Action not allowed' }; return; }
    const params = { ...(c.params || {}) };
    if (SCOPED.has(act)) { params.clientid = clientId; params.userid = clientId; }
    const fnc = mock[act];
    if (!fnc) { out[key] = { result: 'success', totalresults: 0 }; return; }
    try {
      const r = await fnc(params);
      if (['GetInvoice', 'GetSupportTicket', 'GetTicketNotes'].includes(act) && String(r.userid) !== String(clientId)) {
        out[key] = { result: 'error', message: 'not_found' };
      } else {
        out[key] = r;
      }
    } catch (e) {
      out[key] = { result: 'error', message: e.message };
    }
  }));
  return out;
}

const listOf = (obj, key) => {
  const v = obj && obj[key];
  if (!v) return [];
  const inner = v[Object.keys(v)[0]];
  return Array.isArray(inner) ? inner : inner ? [inner] : [];
};

async function dashboard({ clientId }) {
  if (!clientId) throw bridgeError('bad_request', 'clientId is required');
  const [d, p, dm, inv, tk] = await Promise.all([
    mock.GetClientsDetails({ clientid: clientId, stats: true }),
    mock.GetClientsProducts({ clientid: clientId }),
    mock.GetClientsDomains({ clientid: clientId }),
    mock.GetInvoices({ userid: clientId }),
    mock.GetSupportTickets({ clientid: clientId }),
  ]);
  return {
    client: { language: '', ...d.client },
    stats: d.stats || {},
    services: listOf(p, 'products').slice(-5).reverse(),
    domains: listOf(dm, 'domains').slice(0, 5),
    invoices: listOf(inv, 'invoices').sort((a, b) => b.id - a.id).slice(0, 5),
    tickets: String(clientId) === '1' ? listOf(tk, 'tickets').filter((x) => x.status !== 'Closed').slice(0, 5) : [],
  };
}

const OPS = {
  ping: async () => ({ version: '1.0.0', whmcs: '8.13.1', modules: ['cpanel', 'snbd_n8n', 'openclaw_n8n', 'hermesagent', 'ArkHostHetznerVPS', 'pvewhmcs', 'snbdpanel'] }),
  batch, dashboard,
  'service.view': view,
  'service.action': action,
  'service.sso': sso,
  'whmcs.sso': whmcsSso,
};

module.exports = async function mockBridge(op, body = {}) {
  const handler = OPS[op];
  if (!handler) throw bridgeError('bad_request', `Unknown op ${op}`);
  const clientId = parseInt(body.clientId, 10) || 0;
  return handler({ ...body, clientId });
};
