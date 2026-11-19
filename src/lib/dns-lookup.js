'use strict';

const { domainToASCII } = require('node:url');

const RESOLVERS = [
  { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { name: 'Google', url: 'https://dns.google/resolve' },
  { name: 'Quad9', url: 'https://dns.quad9.net:5053/dns-query' },
];
const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA'];
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function normalizeDomain(value) {
  const raw = String(value || '').trim().replace(/\.$/, '');
  if (!raw || raw.length > 253 || /[^\p{L}\p{N}._-]/u.test(raw)) return null;
  const ascii = domainToASCII(raw).toLowerCase();
  return DOMAIN_RE.test(ascii) ? ascii : null;
}

function normalizeType(value) {
  const type = String(value || 'A').toUpperCase();
  return TYPES.includes(type) ? type : null;
}

function answerValue(answer) {
  const data = answer && answer.data;
  if (typeof data !== 'string') return '';
  return data.trim().replace(/\.$/, '').toLowerCase();
}

async function queryResolver(resolver, domain, type, timeoutMs = 6000) {
  const url = `${resolver.url}?name=${encodeURIComponent(domain)}&type=${type}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json, application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const answers = Array.isArray(body.Answer) ? body.Answer.map(answerValue).filter(Boolean) : [];
    return { resolver: resolver.name, status: answers.length ? 'answered' : body.Status === 3 ? 'nxdomain' : 'no-record', answers };
  } catch (error) {
    return { resolver: resolver.name, status: error.name === 'AbortError' ? 'timeout' : 'unavailable', answers: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(domain, type = 'A') {
  const normalized = normalizeDomain(domain);
  const recordType = normalizeType(type);
  if (!normalized) throw new Error('Enter a valid domain name.');
  if (!recordType) throw new Error('That DNS record type is not supported.');
  const results = await Promise.all(RESOLVERS.map((r) => queryResolver(r, normalized, recordType)));
  const signatures = results.filter((r) => r.answers.length).map((r) => r.answers.slice().sort().join('|'));
  const unique = new Set(signatures);
  const answered = results.filter((r) => r.status === 'answered').length;
  return {
    domain: normalized,
    type: recordType,
    results,
    propagation: answered === 0 ? 'no-record' : unique.size === 1 && answered === results.length ? 'consistent' : 'mixed',
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { RESOLVERS, TYPES, normalizeDomain, normalizeType, lookup, queryResolver };
