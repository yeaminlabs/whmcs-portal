'use strict';

const DICTS = {
  en: { ...require('../i18n/en'), ...require('../i18n/services.en'), ...require('../i18n/store.en'), ...require('../i18n/checkout.en') },
  bn: { ...require('../i18n/bn'), ...require('../i18n/services.bn'), ...require('../i18n/store.bn'), ...require('../i18n/checkout.bn') },
};

const LANGS = [
  { code: 'en', label: 'English', short: 'EN', locale: 'en-GB' },
  { code: 'bn', label: 'বাংলা', short: 'বাং', locale: 'bn-BD' },
];

const isLang = (code) => LANGS.some((l) => l.code === code);

function translator(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return function t(key, vars) {
    let s = dict[key];
    if (s == null) s = DICTS.en[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
    return s;
  };
}

function dateFormatter(lang) {
  const locale = (LANGS.find((l) => l.code === lang) || LANGS[0]).locale;
  return function fmtDate(v) {
    if (!v || String(v).startsWith('0000')) return '—';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(String(v));
    return isNaN(d) ? String(v) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
}

module.exports = { LANGS, isLang, translator, dateFormatter };
