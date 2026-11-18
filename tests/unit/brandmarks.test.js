const { n8nMark, bdixFlag, bdixLogo, brandMark, brandTile } = require('../../src/lib/brandmarks');

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
