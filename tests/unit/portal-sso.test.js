const { issue, consume } = require('../../src/lib/portal-sso');

describe('portal SSO handoff', () => {
  test('issues and consumes a signed one-time handoff', () => {
    const token = issue({ clientId: 42, next: '/dashboard', secret: 'shared-secret', now: 1000 });
    expect(consume({ ...token, next: '/dashboard', secret: 'shared-secret', now: 1001 })).toBe(true);
    expect(consume({ ...token, next: '/dashboard', secret: 'shared-secret', now: 1001 })).toBe(false);
  });

  test('rejects a tampered, expired, or wrong-destination handoff', () => {
    const token = issue({ clientId: 42, next: '/dashboard', secret: 'shared-secret', now: 1000 });
    expect(consume({ ...token, next: '/profile', secret: 'shared-secret', now: 1001 })).toBe(false);
    const expired = issue({ clientId: 42, next: '/', secret: 'shared-secret', now: 1000 });
    expect(consume({ ...expired, secret: 'shared-secret', now: 1121 })).toBe(false);
  });
});
