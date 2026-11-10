'use strict';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { performance } = require('perf_hooks');

const config = require('./config');
const { icon } = require('./lib/icons');
const whmcs = require('./lib/whmcs');
const currency = require('./lib/currency');
const { switchAccountCurrency } = require('./lib/account-currency');
const { invalidateClient } = require('./lib/client');
const { warmup } = require('./lib/warmup');
const { LANGS, isLang, translator, dateFormatter } = require('./lib/i18n');

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* ignore malformed cookie */ }
    }
  }
  return out;
}

function money(n, prefix = '') {
  const v = Number(n);
  return prefix + (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const app = express();

app.set('trust proxy', 'loopback');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

const SLOW_MS = 1500;

app.use((req, res, next) => {
  const stats = whmcs.newStats();
  const start = performance.now();
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithTiming(...args) {
    if (!res.headersSent && /^text\/html/i.test(String(res.getHeader('Content-Type') || ''))) {
      const appMs = (performance.now() - start).toFixed(1);
      res.setHeader('Server-Timing', `whmcs;dur=${whmcs.whmcsMs(stats).toFixed(1)};desc="${stats.calls} calls", app;dur=${appMs}`);
    }
    return writeHead.apply(this, args);
  };
  res.on('finish', () => {
    const ms = performance.now() - start;
    if (ms > SLOW_MS) {
      const urlPath = String(req.originalUrl || req.url).split('?')[0];
      console.log(`[perf] ${req.method} ${urlPath} ${Math.round(ms)}ms (whmcs ${stats.calls} calls ${Math.round(whmcs.whmcsMs(stats))}ms)`);
    }
  });
  whmcs.requestStats.run(stats, next);
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(morgan('tiny'));
app.use(require('./routes/pay').stripeWebhook);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 8 },
}));

app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.mock = config.useMock;
  res.locals.icon = icon;
  res.locals.money = money;
  res.locals.googleClientId = config.googleClientId;
  next();
});

app.use(async (req, res, next) => {
  try {
    const cookies = readCookies(req);
    const lang = isLang(cookies.lang) ? cookies.lang : 'en';
    const list = await currency.listCurrencies();
    const account = await currency.accountCurrency(req);
    const display = list.find((c) => c.code === cookies.cur)
      || (account && list.find((c) => c.code === account.code))
      || list[0];
    const t = translator(lang);
    const tOr = (prefix) => (s) => {
      const k = prefix + s;
      const v = t(k);
      return v === k ? s : v;
    };
    Object.assign(res.locals, {
      lang, langs: LANGS, t, fmtDate: dateFormatter(lang), st: tOr('status.'), T: tOr('title.'),
      currencies: list, displayCurrency: display, accountCurrency: account,
      ...currency.helpers(list, display, account), currentPath: req.originalUrl,
      flash: req.session.flash || null,
    });
    req.displayCurrency = display;
    if (req.session.flash && req.method === 'GET') delete req.session.flash;
    next();
  } catch (e) {
    next(e);
  }
});

app.post('/prefs', async (req, res) => {
  const back = typeof req.body.back === 'string' && /^\/(?![\/\\])/.test(req.body.back) ? req.body.back : '/';
  const opts = { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', secure: req.secure, httpOnly: true, path: '/' };
  try {
    if (isLang(req.body.lang)) res.cookie('lang', req.body.lang, opts);
    if (req.body.cur) {
      const list = await currency.listCurrencies();
      const cur = list.find((c) => c.code === req.body.cur);
      if (cur) {
        res.cookie('cur', cur.code, opts);
        if (req.session.clientId) {
          const account = await currency.accountCurrency(req);
          if (account && account.code !== cur.code) {
            try {
              const r = await switchAccountCurrency(req.session.clientId, cur);
              invalidateClient(req.session.clientId);
              if (r.switched) {
                req.session.currency = { id: cur.id, code: cur.code, prefix: cur.prefix };
                req.session.flash = { type: 'ok', key: 'cur.switched', vars: { code: cur.code } };
              } else if (r.reason !== 'same') {
                req.session.flash = { type: 'info', key: r.reason === 'credit' ? 'cur.keptCredit' : 'cur.keptHistory', vars: { code: cur.code, bill: account.code } };
              }
            } catch (err) {
              console.error('[prefs] account currency switch failed:', err.message);
              req.session.flash = { type: 'err', key: 'cur.switchFailed', vars: { code: cur.code, bill: account.code } };
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[prefs]', e.message);
  }
  res.redirect(303, back);
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/store'));
app.use('/', require('./routes/services'));
app.use('/', require('./routes/pay').router);
app.use('/', require('./routes/portal'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.', back: '/' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[portal]', err.message);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.', back: '/' });
});

app.listen(config.port, () => {
  console.log(`WHMCS portal listening on http://localhost:${config.port} (mock=${config.useMock})`);
  warmup().catch((e) => console.warn('[warmup]', e.message));
});

process.on('unhandledRejection', (err) => {
  console.error('[portal] unhandledRejection:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('[portal] uncaughtException:', err.message);
});
