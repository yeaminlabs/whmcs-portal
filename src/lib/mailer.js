'use strict';

const axios = require('axios');
const config = require('../config');

/**
 * Send application mail through Mailgun's HTTP API. Credentials are read only
 * from the runtime environment and are never included in logs or responses.
 */
async function sendMail({ to, subject, text, html, replyTo } = {}) {
  if (!config.mailgun.enabled || !to || !subject || !text) return false;
  const body = new URLSearchParams({
    from: config.mailgun.from,
    to: Array.isArray(to) ? to.join(',') : String(to),
    subject: String(subject),
    text: String(text),
  });
  if (html) body.set('html', String(html));
  if (replyTo) body.set('h:Reply-To', String(replyTo));
  await axios.post(`${config.mailgun.baseUrl}/${encodeURIComponent(config.mailgun.domain)}/messages`, body, {
    auth: { username: 'api', password: config.mailgun.apiKey },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return true;
}

module.exports = { sendMail };
