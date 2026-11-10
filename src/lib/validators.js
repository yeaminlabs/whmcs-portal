'use strict';

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function cleanStr(v, max = 255) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}
function cleanInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function esc(s) {
  return String(s == null ? '' : s);
}

module.exports = { isEmail, cleanStr, cleanInt, esc };
