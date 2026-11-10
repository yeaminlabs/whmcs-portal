const { getClient, invalidateClient } = require('../../src/lib/client');
const whmcs = require('../../src/lib/whmcs');

jest.mock('../../src/lib/whmcs', () => ({
  call: jest.fn(),
  assertSuccess: (data) => { if (!data || data.result !== 'success') throw new Error(data?.message || 'WHMCS error'); return data; }
}));

jest.mock('../../src/lib/cache', () => ({
  cached: (key, ttl, loader) => loader(),
  invalidate: jest.fn()
}));

describe('Client memoization', () => {
  const mockReq = (clientId) => ({
    session: { clientId }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null when no clientId in session', async () => {
    const req = { session: {} };
    const result = await getClient(req);
    expect(result).toBeNull();
  });

  test('fetches client data from WHMCS', async () => {
    const req = mockReq(123);
    const mockData = { client: { id: 123, firstname: 'Test' }, stats: { numactiveservices: 1 } };
    whmcs.call.mockResolvedValue({ result: 'success', ...mockData });
    
    const result = await getClient(req);
    expect(whmcs.call).toHaveBeenCalledWith('GetClientsDetails', { clientid: 123, stats: true });
    expect(result).toEqual({ result: 'success', ...mockData });
  });

  test('memoizes within same request', async () => {
    const req = mockReq(123);
    const mockData = { client: { id: 123 }, stats: {} };
    whmcs.call.mockResolvedValue({ result: 'success', ...mockData });
    
    await getClient(req);
    await getClient(req);
    
    // Should only call WHMCS once per request
    expect(whmcs.call).toHaveBeenCalledTimes(1);
  });

  test('cache invalidation function exists', () => {
    expect(typeof invalidateClient).toBe('function');
    invalidateClient(123);
  });
});
