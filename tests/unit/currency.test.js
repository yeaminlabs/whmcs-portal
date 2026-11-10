const currency = require('../../src/lib/currency');

describe('Currency', () => {
  describe('listCurrencies', () => {
    test('returns mock currencies when MOCK_MODE=true', async () => {
      const currencies = await currency.listCurrencies();
      expect(Array.isArray(currencies)).toBe(true);
      expect(currencies.length).toBeGreaterThan(0);
      
      const bdt = currencies.find(c => c.code === 'BDT');
      expect(bdt).toBeTruthy();
      expect(bdt.prefix).toBe('৳');
      
      const usd = currencies.find(c => c.code === 'USD');
      expect(usd).toBeTruthy();
      expect(usd.prefix).toBe('$');
    });
  });

  describe('format', () => {
    test('formats positive amounts with currency object', () => {
      const bdt = { code: 'BDT', prefix: '৳', format: 2 };
      const usd = { code: 'USD', prefix: '$', format: 2 };
      
      expect(currency.format(100, bdt)).toBe('৳100.00');
      expect(currency.format(100.5, usd)).toBe('$100.50');
      expect(currency.format(0, usd)).toBe('$0.00');
    });

    test('formats negative amounts (prefix before minus)', () => {
      const bdt = { code: 'BDT', prefix: '৳', format: 2 };
      // Current implementation puts minus after prefix
      expect(currency.format(-100, bdt)).toBe('৳-100.00');
    });

    test('handles different decimal places', () => {
      const usd = { code: 'USD', prefix: '$', format: 2 };
      expect(currency.format(100.1, usd)).toBe('$100.10');
      expect(currency.format(100.999, usd)).toBe('$101.00');
    });
  });

  describe('accountCurrency', () => {
    test('returns client account currency', async () => {
      const req = { session: { clientId: 123 } };
      // This would use the mocked getClient
      const result = await currency.accountCurrency(req);
      expect(result).toBeTruthy();
    });
  });
});
