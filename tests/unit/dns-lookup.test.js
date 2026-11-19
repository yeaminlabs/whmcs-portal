const dns = require('../../src/lib/dns-lookup');

describe('DNS lookup', () => {
  test('normalizes domains and allows supported record types only', () => {
    expect(dns.normalizeDomain('  Example.COM. ')).toBe('example.com');
    expect(dns.normalizeDomain('münich.example')).toBe('xn--mnich-kva.example');
    expect(dns.normalizeDomain('https://example.com')).toBeNull();
    expect(dns.normalizeType('txt')).toBe('TXT');
    expect(dns.normalizeType('ANY')).toBeNull();
  });

  test('compares resolver answers and reports propagation state', async () => {
    const oldFetch = global.fetch;
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => ({ Status: 0, Answer: [{ data: url.includes('google') ? '203.0.113.10' : '203.0.113.10.' }] }),
    }));
    try {
      const result = await dns.lookup('example.com', 'A');
      expect(result.propagation).toBe('consistent');
      expect(result.results).toHaveLength(3);
      expect(result.results[0].answers).toEqual(['203.0.113.10']);
    } finally { global.fetch = oldFetch; }
  });

  test('handles resolver failures without failing the whole lookup', async () => {
    const oldFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (url.includes('google')) throw new Error('network');
      return { ok: true, json: async () => ({ Status: 3 }) };
    });
    try {
      const result = await dns.lookup('example.com', 'NS');
      expect(result.propagation).toBe('no-record');
      expect(result.results.map((r) => r.status)).toEqual(['nxdomain', 'unavailable', 'nxdomain']);
    } finally { global.fetch = oldFetch; }
  });
});
