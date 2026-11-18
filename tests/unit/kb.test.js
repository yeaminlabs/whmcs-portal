const kb = require('../../src/lib/kb');
const { sanitize, isoDate } = require('../../scripts/import-kb');

describe('knowledge base content', () => {
  test('articles are loaded with the fields the views need', () => {
    expect(kb.list().length).toBeGreaterThan(0);
    for (const a of kb.list()) {
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(a.title).toBeTruthy();
      expect(a.html).toBeTruthy();
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.minutes).toBeGreaterThanOrEqual(1);
    }
  });
  test('get() finds by slug and rejects anything else', () => {
    const first = kb.list()[0];
    expect(kb.get(first.slug)).toBe(first);
    expect(kb.get('nope')).toBeNull();
    expect(kb.get('../etc/passwd')).toBeNull();
  });
  test('related() excludes the article itself and prefers the same category', () => {
    const a = kb.list().find((x) => kb.list().filter((y) => y.category === x.category).length > 1);
    const rel = kb.related(a, 2);
    expect(rel.every((r) => r.slug !== a.slug)).toBe(true);
    expect(rel[0].category).toBe(a.category);
  });
  test('no stored article contains active content', () => {
    for (const a of kb.list()) expect(a.html).not.toMatch(/<script|<style|<iframe|\son\w+=|javascript:/i);
  });
});

describe('import sanitizer', () => {
  test('drops scripts, handlers and unsafe links but keeps safe markup', () => {
    const out = sanitize('<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://a.test/x" onmouseover="y">ok</a></p><script>alert(1)</script><img src="javascript:1"><pre><code class="language-bash">ls</code></pre>');
    expect(out).not.toMatch(/script|onclick|onmouseover|javascript:|<img/i);
    expect(out).toContain('<a href="https://a.test/x">ok</a>');
    expect(out).toContain('<code class="language-bash">ls</code>');
  });
  test('parses the site date format', () => {
    expect(isoDate('Nov 10, 2026')).toBe('2026-11-10');
    expect(isoDate('Jul 7, 2026')).toBe('2026-07-07');
  });
});
