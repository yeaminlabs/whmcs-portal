const fs = require('fs');
const path = require('path');
const { n8nMark, flagMark, bdixFlag, bdixLogo, brandMark, brandText, brandTile, usNetworks, US_NETWORKS } = require('../../src/lib/brandmarks');

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
    expect(brandMark('USA VPS 2G')).toContain('/img/usa.png');
    expect(brandMark('Plain Hosting Plan')).toBe('');
  });
  test('brandTile chooses the card tile', () => {
    expect(brandTile('n8n n8n Hosting').cls).toBe('n8n');
    expect(brandTile('bdix-vps BDIX VPS').cls).toBe('bdix');
    expect(brandTile('usa-vps USA VPS').cls).toBe('flag');
    expect(brandTile('Plain Hosting Plan')).toEqual({ cls: '', html: '' });
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

describe('region flags', () => {
  const file = (html) => (html.match(/\/img\/(\w+)\.png/) || [])[1];
  test('USA, Singapore and EU names get their own flag', () => {
    for (const t of ['USA VPS 2G', 'USA-01 Starter', 'usa-shared-hosting USA Shared Hosting']) expect(file(flagMark(t))).toBe('usa');
    for (const t of ['SG VPS 2G', 'Singapore VPS', 'sg-vps Singapore VPS']) expect(file(flagMark(t))).toBe('singapore');
    for (const t of ['EU VPS 4G', 'eu-vps EU VPS']) expect(file(flagMark(t))).toBe('eu');
  });
  test('no false matches inside other words', () => {
    for (const t of ['Queue Mode', 'Business Plan', 'Premium', 'Europa Plan'.replace('Europa', 'Eurasia'), 'DE VPS 4G', 'Basic', '']) expect(flagMark(t)).toBe('');
  });
  test('BDIX still wins and keeps its logo; n8n keeps its logo', () => {
    expect(file(flagMark('BDIX VPS 01'))).toBe('bangladesh');
    expect(brandMark('n8n 1G')).toContain('/img/n8n.png');
    expect(bdixFlag('USA VPS 2G')).toBe('');
  });
  test('category cards use the flag as their tile for USA, Singapore and EU', () => {
    for (const t of ['usa-vps USA VPS', 'sg-vps Singapore VPS', 'eu-vps EU VPS']) {
      const tile = brandTile(t);
      expect(tile.cls).toBe('flag');
      expect(tile.html).toContain('tile-flag');
    }
  });
  test('every flag file exists, is a PNG and is small', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['usa', 'singapore', 'eu', 'bangladesh']) {
      const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'img', `${f}.png`));
      expect(buf.subarray(1, 4).toString()).toBe('PNG');
      expect(buf.length).toBeLessThan(20000);
    }
  });
  test('the USA keeps the same eight network logos on both USA pages', () => {
    expect(usNetworks('usa-shared-hosting', 'x')).toBe(usNetworks('usa-vps', 'x'));
  });
});

describe('OpenClaw logo replaces the word', () => {
  test('any capitalisation becomes the logo and the rest of the text stays', () => {
    for (const t of ['OpenClaw 6G', 'Openclaw 4G', 'OPENCLAW 8G']) {
      const html = brandText(t);
      expect(html).toContain('src="/img/openclaw.png"');
      expect(html).toContain('alt="OpenClaw"');
      expect(html.replace(/<img[^>]*>/, '').trim()).toMatch(/^\d+G$/);
    }
    expect(brandText('Automated One-Click OpenClaw Setup')).toMatch(/^Automated One-Click <img[^>]*> Setup$/);
  });
  test('the written word is gone from the output apart from the image alt', () => {
    const html = brandText('Instant Deploy OpenClaw Hosting and openclaw again');
    expect(html.replace(/alt="OpenClaw"/g, '').toLowerCase()).not.toContain('openclaw hosting');
    expect((html.match(/<img/g) || []).length).toBe(2);
  });
  test('other text is escaped, so it cannot inject markup', () => {
    const html = brandText('<script>alert(1)</script> & "q" OpenClaw');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
  test('plain names and empty input pass through unchanged', () => {
    expect(brandText('USA VPS 2G')).toBe('USA VPS 2G');
    expect(brandText(null)).toBe('');
    expect(brandText(undefined)).toBe('');
  });
  test('the OpenClaw group has no icon tile; the logo file is a small transparent PNG', () => {
    expect(brandTile('openclaw-hosting OpenClaw Hosting').cls).toBe('none');
    const fs = require('fs');
    const path = require('path');
    const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'img', 'openclaw.png'));
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(468);
    expect(buf.readUInt32BE(20)).toBe(96);
    expect(buf[25]).toBe(6);
    expect(buf.length).toBeLessThan(60000);
  });
});
