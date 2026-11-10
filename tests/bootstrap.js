// Mock WHMCS Environment for Jest
if (!global.WHMCS) {
  global.WHMCS = true;
}

const mockFunctions = {
  logActivity: (description, clientId = 0) => {},
  logModuleCall: (module, action, request, response, processed = '', replaceVars = []) => {},
  encrypt: (string) => Buffer.from(string).toString('base64'),
  decrypt: (string) => Buffer.from(string, 'base64').toString(),
  localAPI: (action, params, adminUser = '') => ({ result: 'success' }),
  require_once: () => {},
  define: (name, value) => { global[name] = value; }
};

Object.assign(global, mockFunctions);

require('dotenv').config();
process.env.MOCK_MODE = 'true';

require('./setup-mock');
