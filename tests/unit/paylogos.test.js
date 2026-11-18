'use strict';

const { payLogo, logoFor } = require('../../src/lib/paylogos');

describe('payment logos', () => {
  test('bKash gateways map to the bKash logo', () => {
    expect(logoFor('bkashcheckoutUrl').alt).toBe('bKash');
    expect(payLogo('bKash Merchant')).toContain('/img/bkash.png');
  });

  test('only Stripe maps to the Stripe logo', () => {
    expect(logoFor('stripe').alt).toBe('Stripe');
    expect(payLogo('Stripe')).toContain('/img/stripe.png');
    expect(payLogo('Credit/Debit Card (Stripe)')).toContain('/img/stripe.png');
  });

  test('PayPal card wording never gets the Stripe logo', () => {
    expect(payLogo('Paypal Credit/Debit Payment')).toBe('');
    expect(payLogo('paypal_acdc')).toBe('');
    expect(payLogo('Credit / debit card')).toBe('');
  });

  test('other methods get no logo and no markup', () => {
    expect(payLogo('paypal_ppcpv')).toBe('');
    expect(payLogo(undefined)).toBe('');
  });
});
