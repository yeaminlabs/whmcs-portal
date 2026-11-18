const fs = require('fs');
const path = require('path');
const { n8nMark, bdixFlag, bdixLogo, brandMark, brandTile, usNetworks, US_NETWORKS } = require('../../src/lib/brandmarks');

describe('n8n logo helper', () => {
  test('returns the logo for anything that mentions n8n, any case', () => {
    for (const t of ['n8n 1G', 'n8n Hosting', 'N8N', 'n8n', 'Managed n8n instances']) {
      expect(n8nMark(t)).toContain('src="/img/n8n.png"');
    }
  });
  test('returns nothing for other names or empty input', () => {
    for (const t of ['USA VPS', 'BDIX Shared Hosting', '', null, undefined]) expect(n8nMark(t)).toBe('');
  });
  test('the logo is decorative and carries no user text', () => {
    const html = n8nMark('n8n <script>alert(1)</script>');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('script');
  });
});

describe('BDIX marks', () => {
  test('BDIX names get the Bangladesh flag, others do not', () => {
    for (const t of ['BDIX VPS', 'bdix-shared-hosting', 'BDIX-01 Starter', 'BDIX 05']) expect(bdixFlag(t)).toContain('/img/bangladesh.png');
    for (const t of ['USA VPS', 'EU VPS', '', null]) expect(bdixFlag(t)).toBe('');
  });
  test('the BDIX logo only appears for BDIX names and names itself', () => {
    expect(bdixLogo('BDIX VPS')).toContain('src="/img/bdix.png"');
    expect(bdixLogo('BDIX VPS')).toContain('alt="BDIX"');
    expect(bdixLogo('Singapore VPS')).toBe('');
  });
  test('brandMark picks the n8n logo or the BD flag', () => {
    expect(brandMark('n8n 1G')).toContain('/img/n8n.png');
    expect(brandMark('BDIX VPS 01')).toContain('/img/bangladesh.png');
    expect(brandMark('USA VPS 2G')).toBe('');
  });
  test('brandTile chooses the card tile', () => {
    expect(brandTile('n8n n8n Hosting').cls).toBe('n8n');
    expect(brandTile('bdix-vps BDIX VPS').cls).toBe('bdix');
    expect(brandTile('usa-vps USA VPS')).toEqual({ cls: '', html: '' });
  });
});

describe('US network logos', () => {
  test('shown only on the USA Shared Hosting and USA VPS category pages', () => {
    expect(usNetworks('usa-vps', 'Major US networks')).toContain('net-strip');
    expect(usNetworks('usa-shared-hosting', 'x')).toContain('net-strip');
    for (const g of ['bdix-vps', 'n8n', 'eu-vps', 'sg-vps', 'usa-reseller-hosting', '', null]) expect(usNetworks(g, 'x')).toBe('');
  });
  test('all eight logos are present, each its own file with a name', () => {
    const html = usNetworks('usa-vps', 'Major US networks');
    expect(US_NETWORKS.map((n) => n.name)).toEqual(['AT&T', 'CenturyLink', 'Cox', 'Frontier', 'Mediacom', 'Spectrum', 'Verizon', 'Xfinity']);
    for (const n of US_NETWORKS) {
      expect(html).toContain(`src="/img/networks/${n.key}.png"`);
      expect(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'img', 'networks', `${n.key}.png`))).toBe(true);
    }
    expect(html).toContain('alt="AT&amp;T"');
  });
  test('every logo file is a real PNG with transparency and the recorded size', () => {
    for (const n of US_NETWORKS) {
      const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'img', 'networks', `${n.key}.png`));
      expect(buf.subarray(1, 4).toString()).toBe('PNG');
      expect(buf.readUInt32BE(16)).toBe(n.w);
      expect(buf.readUInt32BE(20)).toBe(n.h);
      expect(buf[25]).toBe(6); // colour type 6 = RGBA
    }
  });
  test('caption text is escaped', () => {
    expect(usNetworks('usa-vps', '<b>"x"</b>')).not.toContain('<b>');
  });
});
