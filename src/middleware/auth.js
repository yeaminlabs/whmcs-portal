'use strict';

function requireLogin(req, res, next) {
  if (req.session && req.session.clientId) return next();
  return res.redirect('/login');
}

module.exports = { requireLogin };
