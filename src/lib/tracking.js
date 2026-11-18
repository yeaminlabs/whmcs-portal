'use strict';

/**
 * Google Analytics 4 tracking for the client area, same system as snbdhost.com:
 * GA4 is fired only by the Google Tag Manager container (GTM-N675SJK -> G-WZP9CRYG6B),
 * never by a standalone gtag.js (that would double-count pageviews). The portal pushes
 * events into window.dataLayer; the container forwards them.
 *
 * No personal data is sent: user_id is an HMAC of the WHMCS client id, never an email.
 */
const crypto = require('crypto');
const config = require('../config');

const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/.test(process.env.GTM_ID || '') ? process.env.GTM_ID : 'GTM-N675SJK';
const HOSTS = (process.env.TRACKING_HOSTS || 'app.snbdhost.com').split(',').map((h) => h.trim()).filter(Boolean);
const MAX_QUEUE = 5;

function userId(clientId) {
  if (!clientId) return null;
  return crypto.createHmac('sha256', config.sessionSecret).update(`ga4:${clientId}`).digest('hex').slice(0, 32);
}

/** Queue an event for the next HTML page the visitor sees. */
function queue(req, event) {
  if (!req.session) return;
  const list = Array.isArray(req.session.trackQueue) ? req.session.trackQueue : [];
  list.push(event);
  req.session.trackQueue = list.slice(-MAX_QUEUE);
}

function purchaseEvent(order) {
  const value = Number(order.price) || 0;
  const currency = order.code || 'BDT';
  return {
    event: 'purchase',
    ecommerce: {
      transaction_id: String(order.orderid),
      currency,
      value,
      items: [{ item_id: String(order.product || 'service'), item_name: order.product, item_category: order.group, price: value, quantity: 1 }],
    },
  };
}

/**
 * GA4 ecommerce funnel events the GTM container already has tags for:
 * add_to_cart, view_cart, begin_checkout, add_payment_info. `cart` is { found: {group, product}, cycle, method }.
 * Only product, plan and price are sent, never the domain, hostname or any form field.
 */
function cartEvent(name, cart) {
  const { found, cycle, method } = cart;
  const value = (Number(cycle.price) || 0) + (Number(cycle.setup) || 0);
  const ev = {
    event: name,
    ecommerce: {
      currency: found.product.pricing.code || 'BDT',
      value,
      items: [{
        item_id: String(found.product.slug), item_name: found.product.name, item_category: found.group.name,
        item_variant: cycle.label, price: value, quantity: 1,
      }],
    },
  };
  if (name === 'add_payment_info') ev.ecommerce.payment_type = /bkash/i.test(method || '') ? 'bkash' : /stripe/i.test(method || '') ? 'card' : String(method || '');
  return ev;
}

/** A purchase is a paid invoice (the order itself only creates the invoice). Amounts only, no item text. */
function invoicePurchaseEvent(invoice) {
  const value = Number(invoice.total) || 0;
  return {
    event: 'purchase',
    ecommerce: {
      transaction_id: String(invoice.invoiceid),
      currency: invoice.currencycode || 'BDT',
      value,
      items: [{ item_id: `invoice-${invoice.invoiceid}`, item_name: 'SNBD HOST order', price: value, quantity: 1 }],
    },
  };
}

function hostOf(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].split(':')[0].trim().toLowerCase();
}

/** Exposes res.locals.tracking and drains queued events when a page is rendered. */
function middleware(req, res, next) {
  const render = res.render;
  res.locals.tracking = { gtmId: GTM_ID, hosts: HOSTS, userId: null, events: [], onHost: HOSTS.includes(hostOf(req)) };
  res.render = function patchedRender(...args) {
    const events = Array.isArray(req.session && req.session.trackQueue) ? req.session.trackQueue : [];
    if (events.length) req.session.trackQueue = [];
    res.locals.tracking = {
      gtmId: GTM_ID, hosts: HOSTS, events, onHost: HOSTS.includes(hostOf(req)),
      userId: userId(req.session && req.session.clientId),
    };
    return render.apply(this, args);
  };
  next();
}

module.exports = { GTM_ID, HOSTS, userId, queue, purchaseEvent, cartEvent, invoicePurchaseEvent, middleware };
