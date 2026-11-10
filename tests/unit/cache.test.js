const { cached, invalidate } = require('../../src/lib/cache');

describe('Cache', () => {
  beforeEach(() => {
    // Clear cache between tests
    invalidate('test*');
    invalidate('client:*');
  });

  test('caches value within TTL', async () => {
    let callCount = 0;
    const loader = async () => { callCount++; return { value: 'test', timestamp: Date.now() }; };
    
    const result1 = await cached('test:key', 1000, loader);
    const result2 = await cached('test:key', 1000, loader);
    
    expect(result1).toEqual(result2);
    expect(callCount).toBe(1);
  });

  test('reloads after TTL expires', async () => {
    let callCount = 0;
    const loader = async () => { callCount++; return { value: 'test' + callCount }; };
    
    const result1 = await cached('test:ttl', 50, loader);
    expect(result1.value).toBe('test1');
    
    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 100));
    
    const result2 = await cached('test:ttl', 50, loader);
    expect(result2.value).toBe('test2');
    expect(callCount).toBe(2);
  });

  test('serves stale value during background refresh', async () => {
    let callCount = 0;
    const loader = async () => { callCount++; return { value: 'v' + callCount }; };
    
    // First load
    await cached('test:stale', 50, loader, { staleMs: 1000 });
    expect(callCount).toBe(1);
    
    // Wait past TTL but within stale window
    await new Promise(r => setTimeout(r, 100));
    
    // Should return stale value immediately
    const result = await cached('test:stale', 50, loader, { staleMs: 1000 });
    expect(result.value).toBe('v1');
    
    // Background refresh should happen
    await new Promise(r => setTimeout(r, 50));
    expect(callCount).toBe(2);
  });

  test('invalidate removes entries', async () => {
    const loader = async () => ({ value: 'test' });
    
    await cached('test:invalidate', 1000, loader);
    invalidate('test:invalidate');
    
    // Should reload after invalidation
    let callCount = 0;
    const loader2 = async () => { callCount++; return { value: 'new' }; };
    const result = await cached('test:invalidate', 1000, loader2);
    expect(result.value).toBe('new');
    expect(callCount).toBe(1);
  });

  test('prefix invalidation works', async () => {
    const loader = async () => ({ value: 'test' });
    
    await cached('prefix:a', 1000, loader);
    await cached('prefix:b', 1000, loader);
    await cached('other:c', 1000, loader);
    
    invalidate('prefix*');
    
    let callCount = 0;
    const loader2 = async () => { callCount++; return { value: 'new' }; };
    
    await cached('prefix:a', 1000, loader2);
    await cached('prefix:b', 1000, loader2);
    await cached('other:c', 1000, loader2);
    
    // Only prefix entries should have been reloaded
    expect(callCount).toBe(2);
  });

  test('failed loads are not cached', async () => {
    let callCount = 0;
    const failingLoader = async () => {
      callCount++;
      throw new Error('Load failed');
    };
    
    await expect(cached('test:fail', 1000, failingLoader)).rejects.toThrow('Load failed');
    expect(callCount).toBe(1);
    
    // Second call should retry
    await expect(cached('test:fail', 1000, failingLoader)).rejects.toThrow('Load failed');
    expect(callCount).toBe(2);
  });
});
