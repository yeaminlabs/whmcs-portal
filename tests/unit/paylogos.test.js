'use strict';

const { payLogo, logoFor } = require('../../src/lib/paylogos');

describe('payment logos', () => {
  test('bKash gateways map to the bKash logo', () => {
    expect(logoFor('bkashcheckoutUrl').alt).toBe('bKash');
    expect(payLogo('bKash Merchant')).toContain('/img/bkash.png');
  });

  test('Stripe and card wording map to the Stripe logo', () => {
    expect(logoFor('stripe').alt).toBe('Stripe');
    expect(payLogo('Credit / debit card')).toContain('/img/stripe.png');
  });

  test('other methods get no logo and no markup', () => {
    expect(payLogo('paypal_ppcpv')).toBe('');
    expect(payLogo(undefined)).toBe('');
  });
});
