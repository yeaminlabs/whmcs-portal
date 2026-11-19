const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const PARTIAL = path.join(__dirname, '../../views/partials/country-select.ejs');
const PROFILE = path.join(__dirname, '../../views/profile.ejs');

describe('country-select partial (reusable across modules)', () => {
  beforeAll(() => {
    const i18n = require('i18n-iso-countries');
    i18n.registerLocale(require('i18n-iso-countries/langs/en.json'));
  });

  test('renders every ISO country as a 2-letter value', async () => {
    const i18n = require('i18n-iso-countries');
    const codes = Object.keys(i18n.getAlpha2Codes());
    const countries = codes.map((code) => ({ code, name: i18n.getName(code, 'en') || code }));
    const html = await ejs.renderFile(PARTIAL, {
      t: (k) => k,
      countries,
      name: 'country',
      value: 'BD',
      label: 'Country',
    });
    codes.forEach((code) => {
      expect(html).toContain(`value="${code}"`);
      expect(html).toContain(i18n.getName(code, 'en') || code);
    });
    expect(html).toContain('name="country"');
    expect(html).toContain('id="country"');
    expect(html).toContain('value="BD" selected');
    expect(html).not.toContain('value="US" selected');
  });

  test('works with no value and no required flag', async () => {
    const html = await ejs.renderFile(PARTIAL, { t: (k) => k });
    expect(html).toContain('<option value="">');
    expect(html).not.toContain(' required');
    expect(html).not.toContain(' selected');
  });
});

describe('profile.ejs', () => {
  test('compiles without syntax errors', () => {
    expect(() => ejs.compile(fs.readFileSync(PROFILE, 'utf8'), { filename: PROFILE })).not.toThrow();
  });
});
