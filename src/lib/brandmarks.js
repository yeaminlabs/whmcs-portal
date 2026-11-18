'use strict';

/**
 * Brand marks for the store. Each helper takes any text (a plan, a category, a menu label)
 * and returns an <img> when it mentions the brand, or '' for anything else.
 *   brandMark(text)  small logo/flag printed before a name: n8n logo for n8n, else the region flag
 *   flagMark(text)   region flag only: Bangladesh (BDIX), USA, Singapore (SG), EU
 *   bdixLogo(text)   the BDIX (Bangladesh Internet Exchange) logo, BDIX names only
 *   brandTile(text)  { cls, html } for a card icon tile: n8n logo, BDIX logo or the region flag, else { cls: '', html: '' }
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

/**
 * Regions the store recognises in a plan or category name, first match wins (BDIX before the rest).
 * `flag` is public/img/<flag>.png; w/h are its display size in a name.
 */
const REGIONS = [
  { key: 'bdix', re: /bdix/i, flag: 'bangladesh', name: 'Bangladesh', w: 20, h: 12 },
  { key: 'usa', re: /(^|[^a-z])usa([^a-z]|$)/i, flag: 'usa', name: 'USA', w: 20, h: 11 },
  { key: 'sg', re: /singapore|(^|[^a-z])sg([^a-z]|$)/i, flag: 'singapore', name: 'Singapore', w: 20, h: 13 },
  { key: 'eu', re: /(^|[^a-z])eu([^a-z]|$)|europe/i, flag: 'eu', name: 'EU', w: 20, h: 13 },
];
const regionOf = (text) => REGIONS.find((r) => r.re.test(str(text))) || null;

function flagImg(r, cls) {
  return `<img class="region-flag${cls ? ` ${cls}` : ''}" src="/img/${r.flag}.png" alt="" width="${r.w}" height="${r.h}" decoding="async">`;
}

/** Region flag for a name, or ''. */
function flagMark(text, cls = '') {
  const r = regionOf(text);
  return r ? flagImg(r, cls) : '';
}

/** Bangladesh flag for BDIX names only. */
function bdixFlag(text, cls = '') {
  const r = regionOf(text);
  return r && r.key === 'bdix' ? flagImg(r, cls) : '';
}

function bdixLogo(text, cls = '') {
  if (!BDIX.test(str(text))) return '';
  return `<img class="bdix-logo${cls ? ` ${cls}` : ''}" src="/img/bdix.png" alt="BDIX" width="195" height="125" decoding="async">`;
}

const brandMark = (text, cls = '') => n8nMark(text, cls) || flagMark(text, cls);

function brandTile(text) {
  if (N8N.test(str(text))) return { cls: 'n8n', html: n8nMark(text) };
  const r = regionOf(text);
  if (!r) return { cls: '', html: '' };
  if (r.key === 'bdix') return { cls: 'bdix', html: bdixLogo(text) };
  return { cls: 'flag', html: flagImg(r, 'tile-flag') };
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

module.exports = { n8nMark, flagMark, bdixFlag, bdixLogo, brandMark, brandTile, usNetworks, US_NETWORKS };
