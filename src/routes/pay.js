'use strict';

/**
 * In-portal payments for Stripe (card) and bKash, using the same gateway
 * settings as WHMCS. Payments are recorded on the WHMCS invoice with
 * AddInvoicePayment under the WHMCS gateway name, so invoices, receipts,
 * reports and service activation behave as if WHMCS had taken the payment.
 */
const express = require('express');
const config = require('../config');
const whmcs = require('../lib/whmcs');
const stripe = require('../lib/payments/stripe');
const bkash = require('../lib/payments/bkash');
const { conversion, recordPayment } = require('../lib/payments/record');
const currency = require('../lib/currency');
const { ownedInvoice } = require('../lib/ownership');
const { requireLogin } = require('../middleware/auth');
const { cleanInt, cleanStr } = require('../lib/validators');

const router = express.Router();
const STRIPE_GATEWAY = 'stripe';
const BKASH_GATEWAY = 'bkashcheckoutUrl';

const origin = (req) => `${req.protocol}://${req.get('host')}`;
const due = (invoice) => Math.max(0, Number(invoice.balance) || 0);

async function invoiceCurrencyId(invoice) {
  const list = await currency.listCurrencies();
  const c = list.find((x) => x.code === invoice.currencycode);
  return c ? c.id : (list[0] && list[0].id);
}

async function setGateway(invoice, gateway) {
  if (invoice.paymentmethod === gateway) return;
  await whmcs.call('UpdateInvoice', { invoiceid: invoice.invoiceid, paymentmethod: gateway }).catch(() => null);
}

const notFound = (res) => res.status(404).render('error', { title: 'Not found', message: 'We could not find that in your account.', back: '/invoices' });

// ---------- Stripe (card) ----------

async function stripeAmount(invoice) {
  const amount = due(invoice);
  const list = await currency.listCurrencies();
  const from = list.find((c) => c.code === invoice.currencycode) || list[0];
  const to = list.find((c) => c.id === config.stripe.currencyId) || from;
  const charge = currency.convertAmount(amount, from, to) ?? amount;
  return { amount, charge, minor: Math.round(charge * 100), currency: to };
}

router.get('/invoices/:id/pay/card', requireLogin, async (req, res) => {
  try {
    if (!config.stripe.enabled) return res.redirect(`/invoices/${cleanInt(req.params.id)}/pay`);
    const invoice = await ownedInvoice(req.session.clientId, cleanInt(req.params.id));
    if (!invoice) return notFound(res);
    if (invoice.status !== 'Unpaid') return res.redirect(`/invoices/${invoice.invoiceid}`);
    const amt = await stripeAmount(invoice);
    if (amt.minor < 50) throw new Error(res.locals.t('card.tooSmall'));

    const pending = (req.session.stripe || {})[invoice.invoiceid];
    let intent = null;
    if (pending && pending.minor === amt.minor) {
      intent = await stripe.retrieveIntent(pending.id).catch(() => null);
      if (intent && intent.status === 'succeeded') return res.redirect(`/invoices/${invoice.invoiceid}/pay/card/complete?payment_intent=${intent.id}`);
      if (intent && !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) intent = null;
    }
    if (!intent) {
      intent = await stripe.createIntent({
        amountMinor: amt.minor,
        currency: amt.currency.code.toLowerCase(),
        invoiceId: invoice.invoiceid,
        clientId: req.session.clientId,
        due: amt.amount.toFixed(2),
        fee: '0',
        email: req.session.clientEmail,
        description: `SNBD HOST invoice #${invoice.invoicenum || invoice.invoiceid}`,
      });
      req.session.stripe = { ...(req.session.stripe || {}), [invoice.invoiceid]: { id: intent.id, minor: amt.minor } };
    }
    await setGateway(invoice, STRIPE_GATEWAY);
    res.render('pay-card', {
      title: 'Pay Invoice', invoice, publishableKey: config.stripe.publishableKey, clientSecret: intent.client_secret,
      charge: amt.charge, chargeCurrency: amt.currency, error: null,
    });
  } catch (e) {
    console.error('[pay] stripe setup failed:', e.message);
    res.status(502).render('error', { title: 'Pay Invoice', message: res.locals.t('card.unavailable'), back: `/invoices/${cleanInt(req.params.id)}/pay` });
  }
});

async function completeStripe(intentId, expect = {}) {
  const intent = await stripe.retrieveIntent(intentId);
  const md = intent.metadata || {};
  if (md.source !== 'snbd-portal') return { status: 'ignored' };
  if (expect.invoiceId && String(md.portal_invoice_id) !== String(expect.invoiceId)) return { status: 'mismatch' };
  if (expect.clientId && String(md.portal_client_id) !== String(expect.clientId)) return { status: 'mismatch' };
  if (intent.status === 'processing') return { status: 'processing', invoiceId: md.portal_invoice_id };
  if (intent.status !== 'succeeded' || Number(intent.amount_received) < Number(intent.amount)) return { status: 'unpaid', invoiceId: md.portal_invoice_id };
  const result = await recordPayment({
    invoiceid: md.portal_invoice_id, transid: intent.id, gateway: STRIPE_GATEWAY, amount: md.portal_due, fees: 0, clientId: md.portal_client_id,
  });
  return { status: 'paid', invoiceId: md.portal_invoice_id, ...result };
}

router.get('/invoices/:id/pay/card/complete', requireLogin, async (req, res) => {
  const invoiceId = cleanInt(req.params.id);
  try {
    const intentId = cleanStr(req.query.payment_intent, 100);
    if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) return res.redirect(`/invoices/${invoiceId}/pay`);
    const out = await completeStripe(intentId, { invoiceId, clientId: req.session.clientId });
    if (out.status === 'paid') {
      if (req.session.stripe) delete req.session.stripe[invoiceId];
      return res.redirect(303, `/invoices/${invoiceId}?paid=card`);
    }
    if (out.status === 'processing') return res.redirect(303, `/invoices/${invoiceId}?paid=processing`);
    res.redirect(303, `/invoices/${invoiceId}/pay?failed=card`);
  } catch (e) {
    console.error('[pay] stripe completion failed:', e.message);
    res.redirect(303, `/invoices/${invoiceId}?paid=check`);
  }
});

// Optional: Stripe webhook as a safety net for customers who close the tab
// right after paying. Active only when STRIPE_WEBHOOK_SECRET is configured.
const stripeWebhook = express.Router();
stripeWebhook.post('/webhooks/stripe', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!config.stripe.webhookSecret) return res.status(404).end();
  const raw = req.body.toString('utf8');
  if (!stripe.verifyWebhook(raw, req.get('stripe-signature'), config.stripe.webhookSecret)) return res.status(400).send('bad signature');
  try {
    const event = JSON.parse(raw);
    if (event.type === 'payment_intent.succeeded' && event.data && event.data.object && event.data.object.id) {
      await completeStripe(event.data.object.id);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[pay] stripe webhook failed:', e.message);
    res.status(500).json({ received: false });
  }
});

// ---------- bKash ----------

async function bkashAmounts(invoice) {
  const amount = due(invoice);
  const fee = config.bkash.feePercent > 0 ? (config.bkash.feePercent / 100) * amount : 0;
  const conv = await conversion(await invoiceCurrencyId(invoice), config.bkash.currencyId);
  return { amount, fee, total: Math.ceil((amount + fee) * conv.rate) };
}

async function startBkash(req, res, invoice) {
  const amt = await bkashAmounts(invoice);
  const payment = await bkash.createPayment({
    amount: amt.total,
    invoiceId: invoice.invoiceid,
    payerReference: String(req.session.clientId),
    callbackURL: `${origin(req)}/pay/bkash/callback?invoice=${invoice.invoiceid}`,
  });
  req.session.bkash = { ...(req.session.bkash || {}), [payment.paymentID]: { invoiceid: invoice.invoiceid, due: amt.amount, fee: amt.fee, total: amt.total } };
  await setGateway(invoice, BKASH_GATEWAY);
  res.redirect(303, payment.bkashURL);
}

router.get('/pay/bkash/callback', requireLogin, async (req, res) => {
  const invoiceId = cleanInt(req.query.invoice);
  const paymentID = cleanStr(req.query.paymentID, 100);
  const status = cleanStr(req.query.status, 20).toLowerCase();
  const pending = (req.session.bkash || {})[paymentID];
  try {
    if (!pending || String(pending.invoiceid) !== String(invoiceId)) return res.redirect(303, `/invoices/${invoiceId}/pay?failed=bkash`);
    if (status !== 'success') {
      delete req.session.bkash[paymentID];
      return res.redirect(303, `/invoices/${invoiceId}/pay?failed=${status === 'cancel' ? 'bkash-cancel' : 'bkash'}`);
    }
    let result = await bkash.executePayment(paymentID).catch(() => null);
    if (!result || result.transactionStatus !== 'Completed') {
      result = await bkash.queryPayment(paymentID).catch(() => null);
    }
    if (!result || result.transactionStatus !== 'Completed' || !result.trxID) {
      return res.redirect(303, `/invoices/${invoiceId}/pay?failed=bkash`);
    }
    if (Number(result.amount) + 0.001 < Number(pending.total)) {
      console.error('[pay] bkash amount mismatch', { invoiceId, paid: result.amount, expected: pending.total });
      return res.redirect(303, `/invoices/${invoiceId}?paid=check`);
    }
    await recordPayment({ invoiceid: invoiceId, transid: result.trxID, gateway: BKASH_GATEWAY, amount: pending.due, fees: pending.fee, clientId: req.session.clientId });
    delete req.session.bkash[paymentID];
    res.redirect(303, `/invoices/${invoiceId}?paid=bkash`);
  } catch (e) {
    console.error('[pay] bkash completion failed:', e.message);
    res.redirect(303, `/invoices/${invoiceId}?paid=check`);
  }
});

module.exports = { router, stripeWebhook, startBkash, stripeAmount, bkashAmounts, STRIPE_GATEWAY, BKASH_GATEWAY };
