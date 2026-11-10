const { kindOf, CPANEL_APPS, CONSOLE_FNS, fnIcon, sizeMB, pct, compact, chart } = require('../../src/lib/service-kinds');

describe('Service Kinds', () => {
  test('maps known modules to correct kinds', () => {
    expect(kindOf({ module: 'cpanel' })).toBe('hosting');
    expect(kindOf({ module: 'snbd_n8n' })).toBe('n8n');
    expect(kindOf({ module: 'openclaw_n8n' })).toBe('n8n');
    expect(kindOf({ module: 'hermesagent' })).toBe('hermes');
    expect(kindOf({ module: 'ArkHostHetznerVPS' })).toBe('vps');
    expect(kindOf({ module: 'pvewhmcs' })).toBe('vps');
    expect(kindOf({ module: 'puqProxmoxKVM' })).toBe('vps');
    expect(kindOf({ module: 'snbdpanel' })).toBe('vps');
  });

  test('falls back to generic for unknown modules', () => {
    expect(kindOf({ module: 'unknown_module' })).toBe('generic');
    expect(kindOf({})).toBe('generic');
    expect(kindOf(null)).toBe('generic');
  });

  test('respects view.kind override', () => {
    expect(kindOf({ module: 'cpanel', kind: 'n8n' })).toBe('n8n');
  });

  test('CPANEL_APPS includes expected apps', () => {
    expect(CPANEL_APPS).toContain('');
    expect(CPANEL_APPS).toContain('Email_Webmail');
    expect(CPANEL_APPS).toContain('FileManager_Home');
    expect(CPANEL_APPS).toContain('Database_MySQL');
    expect(CPANEL_APPS).toContain('Database_phpMyAdmin');
    expect(CPANEL_APPS).toContain('Backups_Home');
    expect(CPANEL_APPS).toContain('SSL_TLS_Status');
    expect(CPANEL_APPS).toContain('Domains_Home');
    expect(CPANEL_APPS).toContain('WordPress_Manager');
  });

  test('CONSOLE_FNS includes VNC and noVNC', () => {
    expect(CONSOLE_FNS).toContain('VNC');
    expect(CONSOLE_FNS).toContain('noVNC');
  });

  test('fnIcon returns correct icons', () => {
    expect(fnIcon('start')).toBe('play');
    expect(fnIcon('Start')).toBe('play');
    expect(fnIcon('stop')).toBe('stop');
    expect(fnIcon('Stop')).toBe('stop');
    expect(fnIcon('restart')).toBe('refresh');
    expect(fnIcon('reboot')).toBe('refresh');
    expect(fnIcon('VNC')).toBe('terminal');
    expect(fnIcon('noVNC')).toBe('terminal');
    expect(fnIcon('killswitch')).toBe('power');
    expect(fnIcon('viewlogs')).toBe('file');
    expect(fnIcon('regenpassword')).toBe('key');
    expect(fnIcon('downloadbackup')).toBe('download');
    expect(fnIcon('healthcheck')).toBe('activity');
    expect(fnIcon('upgrade')).toBe('bolt');
    expect(fnIcon('resetpassword')).toBe('key'); // fnIcon returns 'key' for pass/reset
    expect(fnIcon('unknown')).toBe('bolt');
  });

  test('sizeMB formats correctly', () => {
    expect(sizeMB(0)).toBe('0 MB');
    expect(sizeMB(512)).toBe('512 MB');
    expect(sizeMB(1024)).toBe('1 GB');
    expect(sizeMB(1536)).toBe('1.5 GB');
    expect(sizeMB(1024 * 1024)).toBe('1 TB');
    expect(sizeMB(2048 * 1024)).toBe('2 TB');
  });

  test('pct calculates percentage correctly', () => {
    expect(pct(0, 100)).toBe(0);
    expect(pct(50, 100)).toBe(50);
    expect(pct(100, 100)).toBe(100);
    expect(pct(150, 100)).toBe(100); // capped at 100
    expect(pct(0, 0)).toBe(0); // unlimited
    expect(pct(100, 0)).toBe(0); // unlimited
  });

  test('compact formats numbers', () => {
    expect(compact(500)).toBe('500');
    expect(compact(1500)).toBe('1.5K');
    expect(compact(1500000)).toBe('1.5M');
    expect(compact(1500000000)).toBe('1.5B');
  });

  test('chart generates SVG path data', () => {
    const points = [[1, 10], [2, 20], [3, 15]];
    const result = chart(points);
    
    expect(result).toBeTruthy();
    expect(result.w).toBe(600);
    expect(result.h).toBe(140);
    expect(result.line).toContain('M');
    expect(result.line).toContain('L');
    expect(result.area).toContain('Z');
    expect(result.min).toBe(10);
    expect(result.max).toBe(20);
    expect(result.last).toBe(15);
  });

  test('chart returns null for insufficient data', () => {
    expect(chart([])).toBeNull();
    expect(chart([[1, 10]])).toBeNull();
    // NaN and undefined are filtered out, leaving only 1 point -> null
    expect(chart([[1, 10], [2, NaN]])).toBeNull();
    expect(chart([[1, 10], [2, undefined]])).toBeNull();
  });
});
