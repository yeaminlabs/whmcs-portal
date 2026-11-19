const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snbd-uptime-'));
process.env.UPTIME_DB = path.join(dir, 'uptime.sqlite');
const uptime = require('../../src/lib/uptime');

describe('uptime email alert cadence', () => {
  beforeAll(() => uptime.init());
  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  });

  test('alerts immediately, then at most once per hour while down', () => {
    const id = uptime.add(901, { name: 'Test site', url: 'https://example.com', interval: 60 });
    expect(uptime.recordCheckDetectFlip(id, { status: 'down', error: 'timeout' }).alert).toBe(true);
    uptime.markAlertSent(id, Date.now());
    expect(uptime.recordCheckDetectFlip(id, { status: 'down', error: 'timeout' }).alert).toBe(false);
    uptime.markAlertSent(id, Date.now() - (3600 * 1000 + 1));
    expect(uptime.recordCheckDetectFlip(id, { status: 'down', error: 'timeout' }).alert).toBe(true);
  });
});
