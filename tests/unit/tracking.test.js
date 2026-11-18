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

describe('funnel and purchase events', () => {
  const cart = {
    found: { group: { name: 'BDIX Shared Hosting' }, product: { slug: 'starter', name: 'BDIX-01 Starter', pricing: { code: 'BDT' } } },
    cycle: { label: 'Monthly', price: 97, setup: 0 },
    method: 'bkashcheckoutUrl',
  };
  test('cart events carry plan and price only', () => {
    const ev = tracking.cartEvent('add_to_cart', { ...cart, found: { ...cart.found, domain: 'secret.example' } });
    expect(ev.event).toBe('add_to_cart');
    expect(ev.ecommerce).toMatchObject({ currency: 'BDT', value: 97 });
    expect(ev.ecommerce.items[0]).toMatchObject({ item_id: 'starter', item_name: 'BDIX-01 Starter', quantity: 1 });
    expect(JSON.stringify(ev)).not.toContain('secret.example');
  });
  test('add_payment_info says how the customer pays', () => {
    expect(tracking.cartEvent('add_payment_info', cart).ecommerce.payment_type).toBe('bkash');
    expect(tracking.cartEvent('add_payment_info', { ...cart, method: 'stripe' }).ecommerce.payment_type).toBe('card');
  });
  test('a paid invoice becomes one purchase with amounts only', () => {
    const ev = tracking.invoicePurchaseEvent({ invoiceid: 301, total: '14.99', currencycode: 'USD', items: { item: [{ description: 'Hosting - private-domain.com' }] } });
    expect(ev.event).toBe('purchase');
    expect(ev.ecommerce).toMatchObject({ transaction_id: '301', currency: 'USD', value: 14.99 });
    expect(JSON.stringify(ev)).not.toContain('private-domain');
  });
});
