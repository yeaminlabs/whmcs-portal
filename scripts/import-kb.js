#!/usr/bin/env node
'use strict';

/**
 * Imports the public knowledge base (https://snbdhost.com/kb) into src/content/kb.json,
 * which the portal's Help center serves. Re-run to refresh:  node scripts/import-kb.js
 *
 * Article bodies are cleaned to an allowlist of simple tags (no scripts, styles, event
 * handlers or inline styles) so they are safe to print as-is.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE = process.env.KB_SOURCE || 'https://snbdhost.com';
const OUT = path.join(__dirname, '..', 'src', 'content', 'kb.json');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

const decode = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (html) => decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VOID = new Set(['br', 'hr', 'img']);
const ALLOWED = new Set(['p', 'br', 'hr', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img']);
const HEADING_SHIFT = { h1: 'h2' };

function safeUrl(v, { image = false } = {}) {
  const u = decode(v).trim();
  if (/^https:\/\//i.test(u) || (!image && /^(mailto:|\/)/i.test(u) && !/^\/\//.test(u))) return u;
  if (/^http:\/\//i.test(u) && !image) return u;
  return null;
}

/** Rebuilds `html` keeping only allowlisted tags and attributes. */
function sanitize(html) {
  let src = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|form|svg)\b[\s\S]*?<\/\1\s*>/gi, '');
  const out = [];
  const open = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) { out.push(m[4]); continue; }
    if (m[2] === undefined) { out.push('&lt;'); continue; }
    let tag = m[2].toLowerCase();
    tag = HEADING_SHIFT[tag] || tag;
    if (!ALLOWED.has(tag)) continue;
    if (m[1]) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    let kept = '';
    if (tag === 'a') {
      const href = safeUrl(attrs.href || '');
      if (!href) continue;
      kept = ` href="${esc(href)}"`;
    } else if (tag === 'img') {
      const srcUrl = safeUrl(attrs.src || '', { image: true });
      if (!srcUrl) continue;
      kept = ` src="${esc(srcUrl)}" alt="${esc(decode(attrs.alt || ''))}" loading="lazy"`;
    } else if (tag === 'code' && /^language-[a-z0-9+#-]{1,20}$/i.test(attrs.class || '')) {
      kept = ` class="${attrs.class}"`;
    }
    out.push(`<${tag}${kept}>`);
    if (!VOID.has(tag)) open.push(tag);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(s) {
  const m = String(s).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  return m && MONTHS[m[1].toLowerCase()] ? `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}

const get = (url) => axios.get(url, { timeout: 20000, responseType: 'text', headers: { 'User-Agent': 'SNBDHostPortal-KB-Import/1.0' } }).then((r) => String(r.data));

async function main() {
  const index = await get(`${BASE}/kb`);
  const cards = [];
  for (const m of index.matchAll(/<a[^>]+href="\/kb\/([^"/?#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = decodeURIComponent(m[1]);
    if (SLUG_RE.test(slug) && !cards.some((c) => c.slug === slug)) cards.push({ slug, inner: m[2] });
  }
  if (!cards.length) throw new Error('no articles found on the knowledge base index');

  const articles = [];
  for (const card of cards) {
    const page = await get(`${BASE}/kb/${card.slug}`);
    const art = page.match(/<article\b[\s\S]*?<\/article>/);
    if (!art) throw new Error(`no <article> on ${card.slug}`);
    const title = text((art[0].match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
    const summary = text((art[0].match(/<\/h1>\s*<p\b[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
    const body = (art[0].match(/<div class="kb-markdown[^"]*">([\s\S]*?)<\/div>\s*<\/article>/) || [])[1];
    if (!title || !body) throw new Error(`could not read title/body for ${card.slug}`);
    // Category and date live in the index card as small labels: "<category> <date> <title> <summary>".
    const label = text(card.inner);
    const date = isoDate(label);
    const category = label.split(/\s+(?=[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/)[0].trim().slice(0, 40) || 'Guide';
    const html = sanitize(body);
    const words = text(html).split(/\s+/).filter(Boolean).length;
    articles.push({ slug: card.slug, title, summary, category, date, minutes: Math.max(1, Math.round(words / 200)), html });
    console.log(`  ${card.slug}  [${category}] ${date}  ${words} words`);
  }
  articles.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ source: `${BASE}/kb`, importedAt: new Date().toISOString().slice(0, 10), articles }, null, 2)}\n`);
  console.log(`Wrote ${articles.length} articles to ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { sanitize, isoDate };
