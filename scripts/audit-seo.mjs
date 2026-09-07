#!/usr/bin/env node
/**
 * On-page SEO guard for the pages three.ws asks Google to index.
 *
 * Every check here is one a search engine actually acts on, and each one has a
 * failure mode that is invisible locally:
 *
 *   - A duplicate <title> or meta description across pages makes Google pick
 *     one URL for a cluster and drop the rest. Nothing errors; the pages just
 *     stop appearing.
 *   - A canonical pointing somewhere other than the page itself hands the
 *     page's ranking to another URL. A sitemap entry that then says "index me"
 *     contradicts it, and Google resolves the contradiction, not us.
 *   - A page in a sitemap that answers noindex or a non-200 spends crawl
 *     budget to learn nothing, on a site that submits tens of thousands of URLs.
 *   - Structured data that does not parse is dropped whole, taking the rich
 *     result with it. That is how the news archive lost its listing on
 *     2026-09-06 (see api/_lib/safe-text.js).
 *
 * It reads the live site rather than the local build on purpose: only the
 * served response proves what a crawler receives after routing, the shell
 * rewrite and the CDN. Point it at a preview origin with --base to check a
 * change before it ships.
 *
 * Usage:
 *   node scripts/audit-seo.mjs                          # live site, core pages
 *   node scripts/audit-seo.mjs --limit 40               # quick pass
 *   node scripts/audit-seo.mjs --sitemap agents         # another URL set
 *   node scripts/audit-seo.mjs --base http://localhost:3000
 *   node scripts/audit-seo.mjs --strict                 # exit 1 on any error
 *   node scripts/audit-seo.mjs --json report.json       # machine-readable
 */
import { writeFileSync } from 'node:fs';
import { parse } from 'node-html-parser';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const base = (flag('--base', 'https://three.ws') || '').replace(/\/+$/, '');
const sitemapName = flag('--sitemap', 'core');
const limit = Number(flag('--limit', '0')) || 0;
const concurrency = Math.max(1, Number(flag('--concurrency', '8')) || 8);
const strict = args.includes('--strict');
const jsonOut = flag('--json');

// Googlebot, because the site routes crawler UAs to server-rendered handlers.
// Auditing with a browser UA would grade a different response than the one
// being indexed.
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// SERP rendering is measured in pixels, not characters; these are the character
// bounds where truncation becomes likely for typical latin copy. Outside them a
// title is either cut off or too thin to describe the page.
const TITLE_MIN = 15;
const TITLE_MAX = 65;
const DESC_MIN = 70;
const DESC_MAX = 165;

const errors = [];
const warnings = [];
const err = (url, code, detail) => errors.push({ url, code, detail });
const warn = (url, code, detail) => warnings.push({ url, code, detail });

function hasLoneSurrogate(s) {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const n = s.charCodeAt(i + 1);
			if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
			i++;
		} else if (c >= 0xdc00 && c <= 0xdfff) return true;
	}
	return false;
}

async function fetchText(url, timeoutMs = 25_000) {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: ctl.signal, redirect: 'manual' });
		const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
		return { status: res.status, location: res.headers.get('location'), body };
	} finally {
		clearTimeout(timer);
	}
}

async function loadSitemapUrls() {
	const { status, body } = await fetchText(`${base}/sitemap/${sitemapName}.xml`);
	if (status !== 200) throw new Error(`sitemap/${sitemapName}.xml answered ${status}`);
	const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
	if (!urls.length) throw new Error(`sitemap/${sitemapName}.xml declared no URLs`);
	return limit ? urls.slice(0, limit) : urls;
}

const attr = (root, selector, name) => root.querySelector(selector)?.getAttribute(name)?.trim() || '';

function auditPage(url, status, location, html) {
	if (status >= 300 && status < 400) {
		err(url, 'sitemap-redirect', `${status} → ${location || '?'} (a sitemap should list the destination)`);
		return null;
	}
	if (status !== 200) {
		err(url, 'sitemap-dead', `answered ${status}`);
		return null;
	}

	const root = parse(html);
	const title = root.querySelector('title')?.text?.trim() || '';
	const desc = attr(root, 'meta[name="description"]', 'content');
	const canonical = attr(root, 'link[rel="canonical"]', 'href');
	const robots = attr(root, 'meta[name="robots"]', 'content').toLowerCase();
	const lang = root.querySelector('html')?.getAttribute('lang')?.trim() || '';
	const h1s = root.querySelectorAll('h1').filter((n) => n.text.trim().length > 0);

	if (!title) err(url, 'title-missing', 'no <title>');
	else if (title.length < TITLE_MIN) warn(url, 'title-short', `${title.length} chars: ${title}`);
	else if (title.length > TITLE_MAX) warn(url, 'title-long', `${title.length} chars: ${title.slice(0, 70)}…`);

	if (!desc) err(url, 'description-missing', 'no meta description');
	else if (desc.length < DESC_MIN) warn(url, 'description-short', `${desc.length} chars`);
	else if (desc.length > DESC_MAX) warn(url, 'description-long', `${desc.length} chars`);

	if (!canonical) err(url, 'canonical-missing', 'no rel=canonical');
	else if (!/^https?:\/\//.test(canonical)) err(url, 'canonical-relative', canonical);
	else if (canonical.replace(/\/$/, '') !== url.replace(/\/$/, '')) {
		err(url, 'canonical-mismatch', `points at ${canonical}`);
	}

	// A sitemap is a request to index. A page that answers noindex contradicts
	// its own submission, and Google honours the page.
	if (/\bnoindex\b/.test(robots)) err(url, 'noindex-in-sitemap', `robots: ${robots}`);

	if (!lang) warn(url, 'lang-missing', 'no <html lang>');
	if (h1s.length === 0) warn(url, 'h1-missing', 'no non-empty <h1>');
	else if (h1s.length > 1) warn(url, 'h1-multiple', `${h1s.length} <h1> elements`);

	for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) {
		if (!attr(root, `meta[property="${tag}"]`, 'content')) warn(url, 'og-missing', tag);
	}
	if (!attr(root, 'meta[name="twitter:card"]', 'content')) warn(url, 'twitter-card-missing', 'no twitter:card');
	if (!attr(root, 'meta[name="viewport"]', 'content')) err(url, 'viewport-missing', 'no viewport meta');

	let ldTypes = [];
	for (const node of root.querySelectorAll('script[type="application/ld+json"]')) {
		const raw = node.text || '';
		if (hasLoneSurrogate(raw) || /\\u[dD][89abAB][0-9a-fA-F]{2}/.test(raw)) {
			err(url, 'ld-truncated-character', 'JSON-LD carries an unpaired surrogate');
		}
		try {
			const parsed = JSON.parse(raw);
			const nodes = parsed['@graph'] || [parsed];
			for (const n of nodes) {
				if (n && n['@type']) ldTypes.push(Array.isArray(n['@type']) ? n['@type'][0] : n['@type']);
			}
			if (!parsed['@context']) warn(url, 'ld-no-context', 'JSON-LD block without @context');
		} catch (e) {
			err(url, 'ld-unparsable', e.message);
		}
	}
	if (!ldTypes.length) warn(url, 'ld-missing', 'no structured data');

	return { url, title, desc, canonical, ldTypes };
}

async function mapPool(items, worker) {
	const out = new Array(items.length);
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (cursor < items.length) {
				const i = cursor++;
				out[i] = await worker(items[i]);
			}
		}),
	);
	return out;
}

const urls = await loadSitemapUrls();
console.log(`[audit-seo] ${urls.length} URL(s) from ${base}/sitemap/${sitemapName}.xml, concurrency ${concurrency}`);

const pages = (
	await mapPool(urls, async (url) => {
		try {
			const { status, location, body } = await fetchText(url);
			return auditPage(url, status, location, body);
		} catch (e) {
			err(url, 'fetch-failed', e.message);
			return null;
		}
	})
).filter(Boolean);

// Duplicate titles and descriptions are a corpus-level property, so they are
// only knowable once every page has been read.
const byTitle = new Map();
const byDesc = new Map();
for (const p of pages) {
	if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) || []), p.url]);
	if (p.desc) byDesc.set(p.desc, [...(byDesc.get(p.desc) || []), p.url]);
}
for (const [title, list] of byTitle) {
	if (list.length > 1) err(list[0], 'title-duplicate', `${list.length} pages share "${title}": ${list.slice(0, 4).join(', ')}${list.length > 4 ? ' …' : ''}`);
}
for (const [, list] of byDesc) {
	if (list.length > 1) err(list[0], 'description-duplicate', `${list.length} pages share one description: ${list.slice(0, 4).join(', ')}${list.length > 4 ? ' …' : ''}`);
}

const group = (rows) => {
	const m = new Map();
	for (const r of rows) m.set(r.code, [...(m.get(r.code) || []), r]);
	return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};

console.log(`\n[audit-seo] read ${pages.length}/${urls.length} page(s)`);
for (const [label, rows] of [['ERROR', errors], ['WARN', warnings]]) {
	if (!rows.length) continue;
	console.log(`\n${label} (${rows.length})`);
	for (const [code, list] of group(rows)) {
		console.log(`  ${code} × ${list.length}`);
		for (const r of list.slice(0, 5)) console.log(`      ${r.url}\n        ${r.detail}`);
		if (list.length > 5) console.log(`      … ${list.length - 5} more`);
	}
}

if (jsonOut) {
	writeFileSync(jsonOut, JSON.stringify({ base, sitemap: sitemapName, checked: pages.length, errors, warnings }, null, 2) + '\n');
	console.log(`\n[audit-seo] wrote ${jsonOut}`);
}

if (!errors.length && !warnings.length) console.log('\n✓ audit-seo: no on-page SEO defects found');
else console.log(`\n[audit-seo] ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(strict && errors.length ? 1 : 0);
