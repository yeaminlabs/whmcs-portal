const c = require('../../src/content/contact');

describe('contact details', () => {
  test('the displayed number, the call link and the WhatsApp link are the same number', () => {
    const digits = c.phone.display.replace(/\D/g, '');
    expect(c.phone.tel).toBe(`tel:+${digits}`);
    expect(c.phone.whatsapp).toBe(`https://wa.me/${digits}`);
    expect(digits).toBe('8801841528073');
  });
  test('the email address and its mailto link agree', () => {
    expect(c.email.mailto).toBe(`mailto:${c.email.address}`);
    expect(c.email.address).toMatch(/^[^@\s]+@snbdhost\.com$/);
  });
  test('outside links are HTTPS and live chat points at the main site', () => {
    expect(new URL(c.phone.whatsapp).protocol).toBe('https:');
    expect(new URL(c.chatSite).protocol).toBe('https:');
    expect(new URL(c.chatSite).hostname).toBe('snbdhost.com');
  });
  test('the office line names Dhaka, Bangladesh', () => {
    expect(c.office).toContain('Dhaka, Bangladesh');
  });
});
