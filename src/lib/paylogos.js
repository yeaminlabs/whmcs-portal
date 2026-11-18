'use strict';

/**
 * Payment-method logos. payLogo(moduleOrName) returns a ready-to-print <img> for bKash and Stripe
 * (matched on the WHMCS gateway module or display name), or '' for anything else.
 * The images are static project files, so the returned markup contains no user-controlled text.
 */
const LOGOS = [
  { test: /bkash/i, src: '/img/bkash.png', alt: 'bKash', w: 72, h: 40 },
  { test: /stripe/i, src: '/img/stripe.png', alt: 'Stripe', w: 72, h: 30 },
];

function logoFor(key) {
  const k = String(key == null ? '' : key);
  return LOGOS.find((l) => l.test.test(k)) || null;
}

function payLogo(key) {
  const l = logoFor(key);
  return l ? `<img src="${l.src}" alt="${l.alt}" width="${l.w}" height="${l.h}" decoding="async">` : '';
}

module.exports = { payLogo, logoFor };
