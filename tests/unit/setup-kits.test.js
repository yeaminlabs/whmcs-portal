const kits = require('../../src/content/setup-kits');

describe('Downloads & setup kits content', () => {
  test('eight cards, the first three featured: email, WordPress in Bangla, domain connection', () => {
    expect(kits.CARDS).toHaveLength(8);
    expect(kits.CARDS.filter((c) => c.featured).map((c) => c.id)).toEqual(['email', 'wordpress', 'domain']);
    expect(kits.CARDS.slice(0, 3).every((c) => c.featured)).toBe(true);
  });
  test('every card has English and Bangla title, text and button', () => {
    for (const c of kits.CARDS) {
      for (const f of ['title', 'text', 'button']) {
        expect(c[f].en).toBeTruthy();
        expect(c[f].bn).toBeTruthy();
      }
    }
  });
  test('outside links are HTTPS and the label host matches the link', () => {
    for (const c of kits.CARDS.filter((x) => x.badge === 'official')) {
      const u = new URL(c.href);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe(c.host);
    }
  });
  test('SNBD guides stay inside the portal', () => {
    for (const c of kits.CARDS.filter((x) => x.badge === 'guide')) expect(c.href).toMatch(/^\/downloads\/[a-z-]+$/);
  });
  test('personal buttons only use cPanel apps the portal already allows', () => {
    const allowed = require('../../src/lib/service-kinds').CPANEL_APPS;
    for (const c of kits.CARDS.filter((x) => x.personal)) expect(allowed).toContain(c.personal.app);
  });
  test('guides are complete in both languages', () => {
    for (const g of [kits.EMAIL_GUIDE, kits.BKASH_GUIDE]) {
      expect(g.title.en && g.title.bn && g.intro.en && g.intro.bn).toBeTruthy();
      for (const s of g.steps) {
        expect(s.title.en && s.title.bn).toBeTruthy();
        if (Array.isArray(s.body.en)) expect(s.body.bn).toHaveLength(s.body.en.length);
        else expect(s.body.en && s.body.bn).toBeTruthy();
      }
    }
    expect(kits.EMAIL_GUIDE.need.bn).toHaveLength(kits.EMAIL_GUIDE.need.en.length);
    expect(kits.EMAIL_GUIDE.help.items.bn).toHaveLength(kits.EMAIL_GUIDE.help.items.en.length);
  });
  test('the nameservers are the ones SNBD publishes', () => {
    expect(kits.DEFAULT_NAMESERVERS).toEqual(['ns1.snbdhost.com', 'ns2.snbdhost.com']);
  });
});
