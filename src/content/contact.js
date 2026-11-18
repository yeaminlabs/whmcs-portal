'use strict';

/**
 * SNBD HOST contact details, as published on https://snbdhost.com/contact (checked 18 Nov 2026).
 * Phone and WhatsApp share one number; the live-chat widget exists on snbdhost.com only.
 */
const PHONE_DISPLAY = '+880 1841-528073';
const PHONE_DIGITS = '8801841528073';

module.exports = {
  phone: { display: PHONE_DISPLAY, tel: `tel:+${PHONE_DIGITS}`, whatsapp: `https://wa.me/${PHONE_DIGITS}` },
  email: { address: 'support@snbdhost.com', mailto: 'mailto:support@snbdhost.com' },
  chatSite: 'https://snbdhost.com',
  office: 'SNBD HOST — Dhaka, Bangladesh',
};
