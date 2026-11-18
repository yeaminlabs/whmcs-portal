jest.mock('../../src/lib/whmcs', () => ({
  call: jest.fn(),
  assertSuccess: (d) => d,
  isBlocked: () => false,
}));
const whmcs = require('../../src/lib/whmcs');
const catalog = require('../../src/lib/catalog');

describe('payment methods offered by the portal', () => {
  test('only Stripe and bKash are kept, whatever else WHMCS has enabled', async () => {
    whmcs.call.mockResolvedValue({
      result: 'success',
      paymentmethods: { paymentmethod: [
        { module: 'bkashcheckoutUrl', displayname: 'bKash Merchant' },
        { module: 'stripe', displayname: 'Stripe |International Gateways for Credit/Debit Card' },
        { module: 'paypal_ppcpv', displayname: 'PayPal' },
        { module: 'paypal_acdc', displayname: 'Paypal Credit/Debit Payment' },
        { module: 'banktransfer', displayname: 'Bank Transfer' },
      ] },
    });
    const methods = await catalog.paymentMethods();
    expect(methods.map((m) => m.module)).toEqual(['bkashcheckoutUrl', 'stripe']);
  });

  test('isAllowedGateway rejects everything else, including odd input', () => {
    expect(catalog.isAllowedGateway({ module: 'stripe' })).toBe(true);
    expect(catalog.isAllowedGateway({ module: 'BKashCheckoutUrl' })).toBe(true);
    expect(catalog.isAllowedGateway({ module: 'paypal' })).toBe(false);
    expect(catalog.isAllowedGateway({ module: 'notstripe' })).toBe(false);
    expect(catalog.isAllowedGateway(null)).toBe(false);
    expect(catalog.isAllowedGateway({})).toBe(false);
  });
});
