'use strict';

/** Knowledge base articles imported from snbdhost.com/kb (see scripts/import-kb.js). */
const content = require('../content/kb.json');

const articles = Array.isArray(content.articles) ? content.articles : [];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

const list = () => articles;
const get = (slug) => (SLUG_RE.test(String(slug)) ? articles.find((a) => a.slug === slug) || null : null);
const categories = () => [...new Set(articles.map((a) => a.category))];

/** Other articles, same category first, newest first. */
function related(article, limit = 3) {
  return articles
    .filter((a) => a.slug !== article.slug)
    .sort((a, b) => (b.category === article.category) - (a.category === article.category) || b.date.localeCompare(a.date))
    .slice(0, limit);
}

module.exports = { list, get, categories, related };
