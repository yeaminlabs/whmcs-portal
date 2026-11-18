const fs = require('fs');
const path = require('path');
const d = require('../../src/content/dev-downloads');

const icons = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'icons.js'), 'utf8');
const hostOf = (url) => new URL(url).hostname.replace(/^www\./, '');

describe('Developer downloads', () => {
  test('the eight items, in the requested order, with the requested buttons', () => {
    expect(d.DEV.map((c) => c.title.en)).toEqual(['n8n', 'Docker Desktop', 'Docker Engine', 'Ubuntu Server LTS', 'Debian Stable', 'AlmaLinux', 'Ubuntu security updates', 'WordPress core updates']);
    expect(d.DEV.map((c) => c.button.en)).toEqual(['View n8n releases', 'Download Docker Desktop', 'Get Docker Engine', 'Download Ubuntu Server', 'Download Debian', 'Download AlmaLinux', 'View security updates', 'View WordPress releases']);
  });
  test('the four trending picks, in the requested order, with the requested buttons', () => {
    expect(d.TRENDING.map((c) => c.title.en)).toEqual(['Arcane', 'nvm', 'uv', 'Appwrite']);
    expect(d.TRENDING.map((c) => c.button.en)).toEqual(['View Arcane releases', 'View nvm releases', 'Download uv', 'View Appwrite releases']);
    expect(d.TRENDING_CHECKED).toBe('2026-11-18');
  });
  test('every item has English and Bangla text and a button', () => {
    for (const c of [...d.DEV, ...d.TRENDING]) {
      for (const f of ['title', 'text', 'button']) { expect(c[f].en).toBeTruthy(); expect(c[f].bn).toBeTruthy(); }
      for (const tag of c.tags || []) { expect(tag.en).toBeTruthy(); expect(tag.bn).toBeTruthy(); }
      if (c.tip) { expect(c.tip.en).toBeTruthy(); expect(c.tip.bn).toBeTruthy(); }
    }
  });
  test('every link is HTTPS and the host shown on the card belongs to the link', () => {
    for (const c of [...d.DEV, ...d.TRENDING]) {
      const u = new URL(c.href);
      expect(u.protocol).toBe('https:');
      expect(hostOf(c.href).endsWith(c.host.split('/')[0])).toBe(true);
      if (c.secondary) expect(new URL(c.secondary.href).protocol).toBe('https:');
    }
  });
  test('every developer item belongs to a listed category', () => {
    const ids = d.CATEGORIES.map((c) => c.id);
    for (const c of d.DEV) expect(ids).toContain(c.cat);
    for (const c of d.CATEGORIES) { expect(c.label.en).toBeTruthy(); expect(c.label.bn).toBeTruthy(); }
  });
  test('every icon used exists', () => {
    for (const c of [...d.DEV, ...d.TRENDING]) expect(icons).toContain(`  ${c.icon}:`);
  });
  test('only n8n has an account-specific button, and it stays inside the portal', () => {
    const withPersonal = d.DEV.filter((c) => c.personal);
    expect(withPersonal.map((c) => c.id)).toEqual(['n8n']);
    expect(withPersonal[0].personal.kind).toBe('n8n');
  });
});
