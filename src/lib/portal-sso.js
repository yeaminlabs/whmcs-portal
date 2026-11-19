'use strict';

const crypto = require('crypto');

const TTL_SECONDS = 120;
const used = new Map();

function payload({ clientId, expires, nonce, next = '/' }) {
  return [String(clientId), String(expires), String(nonce), String(next)].join('|');
}

function sign(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

function issue({ clientId, next = '/', secret, now = Math.floor(Date.now() / 1000) }) {
  if (!secret || !Number.isInteger(Number(clientId))) throw new Error('SSO_NOT_CONFIGURED');
  const expires = now + TTL_SECONDS;
  const nonce = crypto.randomBytes(18).toString('hex');
  return { clientId: Number(clientId), expires, nonce, signature: sign(payload({ clientId, expires, nonce, next }), secret) };
}

function consume({ clientId, expires, nonce, next = '/', signature, secret, now = Math.floor(Date.now() / 1000) }) {
  if (!secret || !/^\d+$/.test(String(clientId)) || !/^\d+$/.test(String(expires)) || !/^[a-f0-9]{20,128}$/i.test(String(nonce)) || !/^[a-f0-9]{64}$/i.test(String(signature))) return false;
  if (Number(expires) < now || Number(expires) > now + TTL_SECONDS + 30 || used.has(String(nonce))) return false;
  const expected = sign(payload({ clientId, expires, nonce, next }), secret);
  const a = Buffer.from(String(signature), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  used.set(String(nonce), Number(expires));
  for (const [key, until] of used) if (until < now) used.delete(key);
  return true;
}

module.exports = { TTL_SECONDS, issue, consume };
