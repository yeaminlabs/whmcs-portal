const { n8nMark } = require('../../src/lib/brandmarks');

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
