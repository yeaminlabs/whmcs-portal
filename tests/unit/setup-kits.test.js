const kits = require('../../src/content/setup-kits');

describe('Setup guides content', () => {
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
