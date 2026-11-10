require('dotenv').config();

function required(name, fallback = '') {
  return process.env[name] || fallback;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
  whmcsUrl: (process.env.WHMCS_URL || '').replace(/\/+$/, ''),
  whmcsIdentifier: process.env.WHMCS_IDENTIFIER || '',
  whmcsSecret: process.env.WHMCS_SECRET || '',
  mockMode: String(process.env.MOCK_MODE || 'false').toLowerCase() === 'true',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    currencyId: parseInt(process.env.STRIPE_CURRENCY_ID || '0', 10) || null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  bkash: {
    appKey: process.env.BKASH_APP_KEY || '',
    appSecret: process.env.BKASH_APP_SECRET || '',
    username: process.env.BKASH_USERNAME || '',
    password: process.env.BKASH_PASSWORD || '',
    sandbox: String(process.env.BKASH_SANDBOX || 'false').toLowerCase() === 'true',
    feePercent: Number(process.env.BKASH_FEE_PERCENT || 0) || 0,
    currencyId: parseInt(process.env.BKASH_CURRENCY_ID || '0', 10) || null,
  },
  googleClientId: process.env.GOOGLE_CLIENT_ID || '219815663641-p50rq613ol3ilqgbotogg4bb4hvg9s1e.apps.googleusercontent.com',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  uptimerobot: {
    apiKey: process.env.UPTIMEROBOT_API_KEY || '',
    baseUrl: 'https://api.uptimerobot.com/v3',
  },
};

config.bridge = {
  url: process.env.BRIDGE_URL || `${config.whmcsUrl}/modules/addons/snbd_portal_bridge/bridge.php`,
  secret: process.env.BRIDGE_SECRET || '',
};

config.stripe.enabled = Boolean(config.stripe.secretKey && config.stripe.publishableKey);
config.uptimerobot.enabled = Boolean(config.uptimerobot.apiKey);
config.bkash.enabled = Boolean(config.bkash.appKey && config.bkash.appSecret && config.bkash.username && config.bkash.password);
config.useMock = config.mockMode || !config.whmcsUrl || !config.whmcsIdentifier || !config.whmcsSecret;
config.bridge.enabled = Boolean(config.bridge.secret) && !config.useMock;

module.exports = config;
