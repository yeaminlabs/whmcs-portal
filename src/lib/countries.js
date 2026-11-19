'use strict';

const i18n = require('i18n-iso-countries');
i18n.registerLocale(require('i18n-iso-countries/langs/en.json'));

const codes = Object.keys(i18n.getAlpha2Codes());
const countries = codes.map((code) => ({
  code,
  name: i18n.getName(code, 'en') || code,
}));

module.exports = { countries };
