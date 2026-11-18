'use strict';

/**
 * n8n logo for the store. n8nMark(text) returns the logo <img> when `text` mentions n8n
 * (a plan, a category or a menu label), or '' for anything else. The image is decorative
 * (alt is empty) because the n8n name is always printed next to it.
 * Usage in EJS: <%- n8nMark(name) %><%= name %>
 */
const N8N = /n8n/i;

function n8nMark(text, cls = '') {
  if (!N8N.test(String(text == null ? '' : text))) return '';
  return `<img class="n8n-mark${cls ? ` ${cls}` : ''}" src="/img/n8n.png" alt="" width="24" height="13" decoding="async">`;
}

module.exports = { n8nMark };
