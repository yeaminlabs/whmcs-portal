const tracking = require('../../src/lib/tracking');

describe('tracking', () => {
  test('user id is a stable opaque hash, never the client id', () => {
    const a = tracking.userId(1234);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe(tracking.userId(1234));
    expect(a).not.toContain('1234');
    expect(tracking.userId(null)).toBeNull();
  });

  test('queue keeps the last five events', () => {
    const req = { session: {} };
    for (let i = 0; i < 7; i++) tracking.queue(req, { event: `e${i}` });
    expect(req.session.trackQueue.map((e) => e.event)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
  });

  test('purchase event carries order id and value, no personal data', () => {
    const ev = tracking.purchaseEvent({ orderid: 77, product: 'n8n 1G', group: 'n8n', price: '9.5', code: 'USD', clientEmail: 'a@b.c' });
    expect(ev.ecommerce.transaction_id).toBe('77');
    expect(ev.ecommerce.value).toBe(9.5);
    expect(JSON.stringify(ev)).not.toContain('a@b.c');
  });

  test('middleware drains queued events once per render and flags host', () => {
    const req = { session: { clientId: 5, trackQueue: [{ event: 'login', method: 'Google' }] }, headers: { host: 'app.snbdhost.com' } };
    const res = { locals: {}, render: jest.fn() };
    tracking.middleware(req, res, () => {});
    res.render('x');
    expect(res.locals.tracking.events).toEqual([{ event: 'login', method: 'Google' }]);
    expect(res.locals.tracking.onHost).toBe(true);
    expect(req.session.trackQueue).toEqual([]);
    res.render('y');
    expect(res.locals.tracking.events).toEqual([]);
  });
});
