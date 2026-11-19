const catalog = require('../../src/lib/catalog');
const en = require('../../src/i18n/en');
const bn = require('../../src/i18n/bn');

describe('store categories', () => {
  test('OpenClaw hosting is a store category in its own AI agent family', () => {
    const g = catalog.GROUPS.find((x) => x.slug === 'openclaw-hosting');
    expect(g).toBeTruthy();
    expect(g.family).toBe('ai');
    expect(catalog.FAMILIES.map((f) => f.id)).toContain('ai');
  });
  test('both reseller hosting regions are listed in their own family', () => {
    expect(catalog.GROUPS.filter((x) => x.family === 'reseller').map((x) => x.slug)).toEqual([
      'usa-reseller-hosting', 'bdix-reseller-hosting',
    ]);
    expect(catalog.FAMILIES.map((f) => f.id)).toContain('reseller');
  });
  test('every category belongs to a listed family, so none is silently hidden', () => {
    const families = catalog.FAMILIES.map((f) => f.id);
    for (const g of catalog.GROUPS) expect(families).toContain(g.family);
  });
  test('category slugs are unique', () => {
    const slugs = catalog.GROUPS.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  test('every category and family has a name and blurb in English and Bangla', () => {
    for (const g of catalog.GROUPS) {
      for (const dict of [en, bn]) {
        expect(dict[`group.${g.slug}`]).toBeTruthy();
        expect(dict[`groupBlurb.${g.slug}`]).toBeTruthy();
      }
    }
    for (const f of catalog.FAMILIES) {
      expect(en[`family.${f.id}`]).toBeTruthy();
      expect(bn[`family.${f.id}`]).toBeTruthy();
    }
  });
});
