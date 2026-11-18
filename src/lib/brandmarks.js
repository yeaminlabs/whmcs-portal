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

/**
 * The US networks strip shown on the USA Shared Hosting and USA VPS category pages.
 * Each logo is its own transparent PNG (public/img/networks/<key>.png), shown in this order.
 */
const US_NETWORK_GROUPS = new Set(['usa-shared-hosting', 'usa-vps']);
const US_NETWORKS = [
  { key: 'att', name: 'AT&T', w: 151, h: 70 },
  { key: 'centurylink', name: 'CenturyLink', w: 291, h: 71 },
  { key: 'cox', name: 'Cox', w: 162, h: 61 },
  { key: 'frontier', name: 'Frontier', w: 192, h: 50 },
  { key: 'mediacom', name: 'Mediacom', w: 251, h: 61 },
  { key: 'spectrum', name: 'Spectrum', w: 235, h: 60 },
  { key: 'verizon', name: 'Verizon', w: 219, h: 56 },
  { key: 'xfinity', name: 'Xfinity', w: 169, h: 68 },
];
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Strip of US network logos for a USA category page, '' for any other group. `label` is the printed caption. */
function usNetworks(groupSlug, label = '') {
  if (!US_NETWORK_GROUPS.has(str(groupSlug))) return '';
  const logos = US_NETWORKS.map((n) => `<img src="/img/networks/${n.key}.png" alt="${attr(n.name)}" width="${n.w}" height="${n.h}" loading="lazy" decoding="async">`).join('');
  return `<div class="net-strip" role="group" aria-label="${attr(label)}">${label ? `<p class="net-strip-label">${attr(label)}</p>` : ''}<div class="net-strip-logos">${logos}</div></div>`;
}

module.exports = { n8nMark, bdixFlag, bdixLogo, brandMark, brandTile, usNetworks, US_NETWORKS };
