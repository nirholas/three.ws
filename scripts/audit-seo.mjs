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
 *   - FAQ markup for questions the page does not show is treated by Bing
 *     and Google as misleading structured data.
 *
 * It reads a served origin rather than the local build on purpose: only the
 * response proves what a crawler receives after routing, the shell rewrite
 * and the CDN. The default run reads the sitemap index, counts every URL it
 * declares, and crawls a sample spread across every type (core pages, agents,
 * avatars, creations, widgets, profiles, news), so a defect in any one
 * renderer shows up. Point --base at the dev server or a preview to check a
 * change before it ships; sitemap URLs are fetched from that origin while
 * canonicals are still compared against the production URL.
 *
 * Exits 1 on any error (missing or duplicate title, description or canonical,
 * a dead or noindex sitemap entry, broken structured data).
 *
 * Usage:
 *   npm run audit:seo                                   # live site, index sample
 *   npm run audit:seo -- --sample 50                    # a bigger sample per type
 *   npm run audit:seo -- --sitemap core                 # every URL in one child file
 *   npm run audit:seo -- --sitemap agents --limit 40
 *   npm run audit:seo -- --base http://localhost:3123   # the dev server
 *   npm run audit:seo -- --report-only                  # never exit 1
 *   npm run audit:seo -- --json report.json             # machine-readable
 *
 * Runbook: docs/ops/bing-and-indexnow.md.
 */
import { writeFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { faqVisibility } from '../api/_lib/structured-data.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const base = (flag('--base', 'https://three.ws') || '').replace(/\/+$/, '');
const sitemapName = flag('--sitemap', null);
const limit = Number(flag('--limit', '0')) || 0;
const samplePerType = Math.max(1, Number(flag('--sample', '20')) || 20);
const concurrency = Math.max(1, Number(flag('--concurrency', '8')) || 8);
const reportOnly = args.includes('--report-only');
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

// A dev server restarts whenever its config changes, which refuses connections
// for a few seconds. Retry connection-level failures so a restart is waited
// out instead of reported as a dead page; an HTTP status is never retried.
async function fetchText(url, timeoutMs = 25_000) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fetchOnce(url, timeoutMs);
		} catch (e) {
			const code = e?.cause?.code || '';
			if (attempt >= 6 || !/ECONNREFUSED|ECONNRESET|EPIPE|UND_ERR_SOCKET/.test(code)) throw e;
			await new Promise((r) => setTimeout(r, attempt * 2_000));
		}
	}
}

async function fetchOnce(url, timeoutMs) {
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

// Sitemaps name production URLs. Fetch them from --base, keep the production
// URL as the identity a canonical is compared against.
const fetchUrlFor = (loc) => {
	try {
		const u = new URL(loc);
		return `${base}${u.pathname}${u.search}`;
	} catch {
		return loc;
	}
};

async function readSitemap(loc) {
	const { status, body } = await fetchText(fetchUrlFor(loc), 120_000);
	if (status !== 200) throw new Error(`${loc} answered ${status}`);
	return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/&amp;/g, '&'));
}

// Every nth URL, so a sample covers a file end to end instead of its oldest rows.
function spread(list, n) {
	if (list.length <= n) return list;
	const step = list.length / n;
	return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

const typeOf = (loc) => (loc.match(/\/sitemap\/([a-z]+)(?:-\d+)?\.xml$/) || [])[1] || 'other';

/** { urls to crawl, per-type URL counts declared by the sitemaps } */
async function loadSitemapUrls() {
	if (sitemapName) {
		const urls = await readSitemap(`https://three.ws/sitemap/${sitemapName}.xml`);
		if (!urls.length) throw new Error(`sitemap/${sitemapName}.xml declared no URLs`);
		return { urls: limit ? urls.slice(0, limit) : urls, counts: { [sitemapName]: urls.length }, source: `sitemap/${sitemapName}.xml` };
	}
	const children = await readSitemap('https://three.ws/sitemap.xml');
	if (!children.length) throw new Error('sitemap.xml declared no child sitemaps');
	const byType = new Map();
	for (const child of children) {
		const urls = await readSitemap(child);
		const t = typeOf(child);
		byType.set(t, [...(byType.get(t) || []), ...urls]);
	}
	const counts = Object.fromEntries([...byType].map(([t, list]) => [t, list.length]));
	const urls = [...byType.values()].flatMap((list) => spread(list, samplePerType));
	return { urls: limit ? urls.slice(0, limit) : urls, counts, source: `sitemap.xml (${children.length} child file(s), ${samplePerType} per type)` };
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

	const faq = faqVisibility(html);
	if (faq.questions.length && !faq.visible.length) {
		err(url, 'faq-not-shown', `FAQPage declares ${faq.questions.length} question(s), none visible on the page`);
	} else {
		for (const q of faq.hidden) warn(url, 'faq-question-hidden', `FAQPage question not shown on the page: ${q}`);
	}

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

const { urls, counts, source } = await loadSitemapUrls();
const declared = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`[audit-seo] ${base}: ${source} declares ${declared} URL(s)`);
for (const [t, n] of Object.entries(counts)) console.log(`    ${t.padEnd(10)} ${String(n).padStart(7)}`);
console.log(`[audit-seo] crawling ${urls.length} URL(s), concurrency ${concurrency}`);

const pages = (
	await mapPool(urls, async (url) => {
		try {
			const { status, location, body } = await fetchText(fetchUrlFor(url));
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
const byCanonical = new Map();
for (const p of pages) if (p.canonical) byCanonical.set(p.canonical, [...(byCanonical.get(p.canonical) || []), p.url]);
for (const [canonical, list] of byCanonical) {
	if (list.length > 1) err(list[0], 'canonical-duplicate', `${list.length} sitemap URLs claim the canonical ${canonical}: ${list.slice(0, 4).join(', ')}`);
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
	writeFileSync(jsonOut, JSON.stringify({ base, source, declared: counts, checked: pages.length, errors, warnings }, null, 2) + '\n');
	console.log(`\n[audit-seo] wrote ${jsonOut}`);
}

if (!errors.length && !warnings.length) console.log('\n✓ audit-seo: no on-page SEO defects found');
else console.log(`\n[audit-seo] ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(!reportOnly && errors.length ? 1 : 0);
