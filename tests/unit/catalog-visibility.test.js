jest.mock('axios');
const axios = require('axios');
const catalog = require('../../src/lib/catalog');
const config = require('../../src/config');

const storePage = (group, slugs) => `<link rel="canonical" href="https://whmcs.test/store/${group}">
<a href="/store/${group}">${group}</a>${slugs.map((s) => `<a href="/store/${group}/${s}">${s}</a>`).join('')}`;

describe('store visibility sync (hidden / retired WHMCS products)', () => {
  beforeEach(() => { config.whmcsUrl = 'https://whmcs.test'; axios.get.mockReset(); });

  test('lists only the products WHMCS shows on the group page', async () => {
    axios.get.mockResolvedValue({ status: 200, data: storePage('n8n', ['n8n-1g', 'n8n-2g']) });
    expect([...await catalog.fetchVisibleSlugs('n8n')].sort()).toEqual(['n8n-1g', 'n8n-2g']);
  });

  test('a group whose products are all hidden is an empty answer, not an error', async () => {
    axios.get.mockResolvedValue({ status: 200, data: storePage('zaynco', []) });
    expect((await catalog.fetchVisibleSlugs('zaynco')).size).toBe(0);
  });

  test('a hidden group (WHMCS redirects within /store) is an empty answer', async () => {
    axios.get.mockResolvedValue({ status: 302, headers: { location: '/store/usa-shared-hosting' }, data: '' });
    expect((await catalog.fetchVisibleSlugs('secret')).size).toBe(0);
  });

  test('an error or maintenance page is an error, never "everything hidden"', async () => {
    axios.get.mockResolvedValue({ status: 200, data: '<html>Under maintenance</html>' });
    await expect(catalog.fetchVisibleSlugs('n8n')).rejects.toThrow(/not a WHMCS store page/);
    axios.get.mockResolvedValue({ status: 302, headers: { location: '/login' }, data: '' });
    await expect(catalog.fetchVisibleSlugs('n8n')).rejects.toThrow(/unexpected redirect/);
  });

  test('never throws a hidden product into a sibling group', async () => {
    axios.get.mockResolvedValue({ status: 200, data: storePage('n8n', ['a']) + '<a href="/store/usa-vps/zzz">x</a>' });
    expect([...await catalog.fetchVisibleSlugs('n8n')]).toEqual(['a']);
  });
});

describe('store page address', () => {
  const catalogLib = require('../../src/lib/catalog');
  test('an explicit WHMCS_STORE_URL wins', async () => {
    config.whmcsStoreUrl = 'https://public.test';
    expect(await catalogLib.storeBase('n8n')).toBe('https://public.test');
    config.whmcsStoreUrl = '';
  });
});
