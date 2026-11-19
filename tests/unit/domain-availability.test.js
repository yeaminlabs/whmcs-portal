const { domainAvailability } = require('../../src/lib/domain-availability');

describe('domain availability normalization', () => {
  test.each([
    [{ status: 'available' }, true],
    [{ status: ' Available ' }, true],
    [{ status: 'unavailable' }, false],
    [{ status: 'registered' }, false],
    [{ available: true }, true],
    [{ data: { is_domain_available: true } }, true],
    [{ status: 'unexpected' }, null],
    [{}, null],
  ])('maps %j to %j', (response, expected) => {
    expect(domainAvailability(response)).toBe(expected);
  });
});
