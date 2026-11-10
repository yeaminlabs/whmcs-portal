// Override require to mock WHMCS modules
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(path) {
  // Mock whmcs module
  if (path === 'whmcs') {
    return class WHMCS {
      constructor(config) { this.config = config; }
    };
  }
  // Mock dotenv
  if (path === 'dotenv') {
    return { config: () => {} };
  }
  return originalRequire.apply(this, arguments);
};

// Mock config for tests
jest.mock('../src/config', () => ({
  port: 3000,
  sessionSecret: 'test-secret',
  whmcsUrl: 'https://test.whmcs.com',
  whmcsIdentifier: 'test-id',
  whmcsSecret: 'test-secret',
  mockMode: true,
  useMock: true,
  bridge: {
    url: 'http://localhost/bridge.php',
    secret: 'test-bridge-secret',
    enabled: true
  },
  stripe: { enabled: false },
  bkash: { enabled: false },
  googleClientId: 'test-client-id',
  uptimerobot: { enabled: false }
}));
