const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '../../views');

const icon = () => '<i></i>';
const t = (k, v) => {
  const d = {
    'auth.forgotTitle': 'Forgot password',
    'auth.forgotSub': 'Reset your password through WHMCS.',
    'auth.enterEmail': 'Enter a valid email address.',
    'auth.forgot': 'Forgot password?',
    'auth.loginBtn': 'Log in',
    'prof.email': 'Email',
    'pw.reset.title': 'Reset your password',
    'pw.reset.sub': 'Choose a new password for your account.',
    'pw.reset.send': 'Send reset link',
    'pw.reset.newPassword': 'New password',
    'pw.reset.confirm': 'Confirm new password',
    'pw.reset.reset': 'Reset password',
    'sec.twoFactor': 'Two-factor authentication',
    'sec.twoFactorEnabled': 'Enabled',
    'sec.twoFactorDisabled': 'Not enabled',
    'sec.tfSetup': 'Set up two-factor',
    'sec.tfRemove': 'Remove two-factor',
    'sec.twoFactorDesc': 'Add a one-time code from an authenticator app.',
    'tf.setupTitle': 'Set up two-factor authentication',
    'tf.verifyTitle': 'Two-factor verification',
    'tf.removeTitle': 'Remove two-factor authentication',
    'tf.backupTitle': 'Save your backup codes',
    'sec.forgotTitle': 'Forgot your password?',
    'sec.forgotSub': 'Send yourself a secure reset link through WHMCS.',
    'sec.forgotCta': 'Reset password',
    'auth.showPassword': 'Show password',
    'auth.hidePassword': 'Hide password',
    'sec.save': 'Change password',
    'common.saveChanges': 'Save changes',
  };
  let s = d[k] || k;
  if (v) s = s.replace(/\{(\w+)\}/g, (m, key) => String(v[key] === undefined ? m : v[key]));
  return s;
};

const baseLocals = {
  t, T: (s) => s, lang: 'en',
  langs: [{ code: 'en', label: 'English', short: 'EN' }, { code: 'bn', label: 'বাংলা', short: 'বাং' }],
  ti: 'Forgot password', title: 'Forgot password',
  session: { clientId: 1, clientName: 'Demo User', clientEmail: 'demo@example.com', clientPicture: null, twoFactor: false },
  customer: { firstname: 'Demo', lastname: 'User', email: 'demo@example.com' },
  updated: false, error: null, sent: null, done: null, token: 'abcd1234',
  twoFactor: false, twoFactorUrl: 'https://example.com/clientarea.php?action=twofactor',
  icon, currentPath: '/forgot-password', tracking: null, flash: null, mock: false,
  currencies: [{ code: 'BDT', prefix: '৳' }],
  displayCurrency: { code: 'BDT', prefix: '৳' },
  accountCurrency: { code: 'BDT' },
};

async function render(file, locals) {
  try {
    return await ejs.renderFile(path.join(VIEWS, file), locals, {});
  } catch (err) {
    err.message = `${file}: ${err.message}`;
    throw err;
  }
}

describe('new views compile and render', () => {
  test('forgot-password.ejs compiles and renders', async () => {
    const html = await render('forgot-password.ejs', baseLocals);
    expect(html).toContain('Forgot password');
    expect(html).toContain('name="email"');
  });

  test('reset-password.ejs compiles and renders with token', async () => {
    const html = await render('reset-password.ejs', baseLocals);
    expect(html).toContain('Reset your password');
    expect(html).toContain('name="token"');
    expect(html).toContain('value="abcd1234"');
  });

  test('security.ejs shows native set-up action when 2FA is off', async () => {
    const html = await render('security.ejs', { ...baseLocals, twoFactor: false, backupCodesLeft: 0, tfNotice: null });
    expect(html).toContain('Two-factor authentication');
    expect(html).toContain('href="/security/2fa/setup"');
    expect(html).not.toContain('/security/2fa/disable');
    expect(html).not.toContain('action=twofactor');
    expect(html).toContain('/forgot-password');
  });

  test('security.ejs shows remove action and backup count when 2FA is on', async () => {
    const html = await render('security.ejs', { ...baseLocals, twoFactor: true, backupCodesLeft: 7, tfNotice: 'on' });
    expect(html).toContain('href="/security/2fa/disable"');
    expect(html).not.toContain('href="/security/2fa/setup"');
    expect(html).toContain('<b>7</b>');
  });

  test('2FA setup, backup, disable and login challenge views render', async () => {
    const setup = await render('twofactor-setup.ejs', { ...baseLocals, error: null, qr: 'data:image/png;base64,AA', secret: 'JBSW Y3DP' });
    expect(setup).toContain('action="/security/2fa/setup"');
    expect(setup).toContain('data:image/png;base64,AA');
    const backup = await render('twofactor-backup.ejs', { ...baseLocals, codes: ['abcd-efgh', 'jkmn-pqrs'] });
    expect(backup).toContain('abcd-efgh');
    expect(backup).toContain('/security?tf=on');
    const disable = await render('twofactor-disable.ejs', { ...baseLocals, error: null });
    expect(disable).toContain('action="/security/2fa/disable"');
    const verify = await render('twofactor-verify.ejs', { ...baseLocals, error: 'bad' });
    expect(verify).toContain('action="/login/2fa"');
    expect(verify).toContain('bad');
  });

  test('login.ejs compiles with forgot link', async () => {
    const html = await render('login.ejs', { ...baseLocals, ti: 'Log in', title: 'Log in', googleClientId: 'x', next: '' });
    expect(html).toContain('/forgot-password');
    expect(html).toContain('Forgot password?');
  });
});
