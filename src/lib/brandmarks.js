'use strict';

/**
 * Brand marks for the store. Each helper takes any text (a plan, a category, a menu label)
 * and returns an <img> when it mentions the brand, or '' for anything else.
 *   brandMark(text)  small logo/flag printed before a name: n8n logo for n8n, Bangladesh flag for BDIX
 *   bdixLogo(text)   the BDIX (Bangladesh Internet Exchange) logo, BDIX names only
 *   brandTile(text)  { cls, html } for a card icon tile: n8n logo or BDIX logo, else { cls: '', html: '' }
 * The images are decorative (alt is empty) because the name is always printed next to them,
 * except the standalone BDIX logo, which names itself.
 */
const N8N = /n8n/i;
const BDIX = /bdix/i;
const str = (v) => String(v == null ? '' : v);

function n8nMark(text, cls = '') {
  if (!N8N.test(str(text))) return '';
  return `<img class="n8n-mark${cls ? ` ${cls}` : ''}" src="/img/n8n.png" alt="" width="24" height="13" decoding="async">`;
}

function bdixFlag(text, cls = '') {
  if (!BDIX.test(str(text))) return '';
  return `<img class="bd-flag${cls ? ` ${cls}` : ''}" src="/img/bangladesh.png" alt="" width="20" height="12" decoding="async">`;
}

function bdixLogo(text, cls = '') {
  if (!BDIX.test(str(text))) return '';
  return `<img class="bdix-logo${cls ? ` ${cls}` : ''}" src="/img/bdix.png" alt="BDIX" width="200" height="125" decoding="async">`;
}

const brandMark = (text, cls = '') => n8nMark(text, cls) || bdixFlag(text, cls);

function brandTile(text) {
  if (N8N.test(str(text))) return { cls: 'n8n', html: n8nMark(text) };
  if (BDIX.test(str(text))) return { cls: 'bdix', html: bdixLogo(text) };
  return { cls: '', html: '' };
}

module.exports = { n8nMark, bdixFlag, bdixLogo, brandMark, brandTile };
