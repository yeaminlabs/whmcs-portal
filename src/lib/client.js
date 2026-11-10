'use strict';

/**
 * The signed-in client's GetClientsDetails (with stats), fetched at most once per
 * request and shared across requests for 10 seconds. Call invalidateClient(id)
 * after anything that changes the client's details, credit, currency or invoices.
 */
const whmcs = require('./whmcs');
const { cached, invalidate } = require('./cache');

const TTL = 10 * 1000;
const perRequest = new WeakMap();

const key = (id) => `client:${id}`;

/** Resolves to the GetClientsDetails response, null when signed out; rejects when WHMCS fails. */
function getClient(req) {
  const id = req.session && req.session.clientId;
  if (!id) return Promise.resolve(null);
  const memo = perRequest.get(req);
  if (memo && memo.id === id) return memo.promise;
  const promise = cached(key(id), TTL, async () => whmcs.assertSuccess(
    await whmcs.call('GetClientsDetails', { clientid: id, stats: true }),
  ));
  promise.catch(() => {});
  perRequest.set(req, { id, promise });
  return promise;
}

function invalidateClient(id) {
  if (id) invalidate(key(id));
}

module.exports = { getClient, invalidateClient };
