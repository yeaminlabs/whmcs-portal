'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('contacts privacy boundary', () => {
  test('has no dashboard route, navigation entry, view, or bridge action', () => {
    expect(read('src/routes/portal.js')).not.toMatch(/router\.(get|post)\(['"]\/contacts/);
    expect(read('views/_head.ejs')).not.toContain("href: '/contacts'");
    expect(fs.existsSync(path.join(root, 'views/contacts.ejs'))).toBe(false);
    expect(read('src/lib/mock-bridge.js')).not.toContain('GetContacts');
    expect(read('whmcs-module/modules/addons/snbd_portal_bridge/lib/Catalog.php')).not.toContain('GetContacts');
  });
});
