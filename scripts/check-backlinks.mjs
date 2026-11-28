#!/usr/bin/env node
/**
 * Backlink readout for three.ws: which third-party pages that mention us
 * actually pass link equity.
 *
 * Ahrefs DR4 (2026) only gives real weight to links from sites with organic
 * search traffic, and like every link metric it ignores links marked
 * rel="nofollow", "ugc" or "sponsored". A mention with no link counts for
 * nothing at all. This script fetches every page in
 * marketing/growth/backlink-placements.json and sorts each into one of:
 *
 *   followed   at least one <a href> to three.ws without a nofollow-family rel
 *   nofollow   links to three.ws, every one marked nofollow/ugc/sponsored
 *   unlinked   names three.ws in the page text but never links it (ask them to)
 *   gone       neither links nor mentions three.ws any more
 *   blocked    the site refused the fetch (bot wall); check it by hand
 *
 * A page-level <meta name="robots" content="nofollow"> or an X-Robots-Tag
 * nofollow header demotes every link on the page to nofollow.
 *
 * Usage:
 *   npm run seo:backlinks
 *   npm run seo:backlinks -- --json
 *   npm run seo:backlinks -- --url https://example.com/post   (one page, not in the list)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'node-html-parser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = resolve(ROOT, 'marketing/growth/backlink-placements.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const TARGET_HOST = /^(?:[a-z0-9-]+\.)*three\.ws$/i;
const NOFOLLOW_REL = /\b(?:nofollow|ugc|sponsored)\b/i;

function isThreeWs(href, base) {
	try {
		const u = new URL(href, base);
		return (u.protocol === 'https:' || u.protocol === 'http:') && TARGET_HOST.test(u.hostname);
	} catch {
		return false;
	}
}

/** Classify one fetched page. Pure, so it is unit tested without the network. */
export function classifyPage({ url, html, robotsHeader = '' }) {
	const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
	const metaRobots = root
		.querySelectorAll('meta')
		.filter((m) => /^(?:robots|googlebot)$/i.test(m.getAttribute('name') || ''))
		.map((m) => m.getAttribute('content') || '')
		.join(',');
	const pageNofollow = /\bnofollow\b/i.test(`${metaRobots},${robotsHeader}`);

	const links = root
		.querySelectorAll('a[href]')
		.filter((a) => isThreeWs(a.getAttribute('href'), url))
		.map((a) => ({
			href: new URL(a.getAttribute('href'), url).href,
			followed: !pageNofollow && !NOFOLLOW_REL.test(a.getAttribute('rel') || ''),
		}));
	const mentioned = /\bthree\.ws\b/i.test(root.text);

	const followed = links.filter((l) => l.followed);
	let status;
	if (followed.length) status = 'followed';
	else if (links.length) status = 'nofollow';
	else if (mentioned) status = 'unlinked';
	else status = 'gone';

	return {
		status,
		pageNofollow,
		links: links.length,
		followedTargets: [...new Set(followed.map((l) => l.href))],
	};
}

async function fetchPage(url) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 25_000);
	try {
		const res = await fetch(url, {
			headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
			redirect: 'follow',
			signal: ctrl.signal,
		});
		const html = await res.text();
		return { ok: res.ok, code: res.status, html, robotsHeader: res.headers.get('x-robots-tag') || '' };
	} catch (err) {
		return { ok: false, code: 0, html: '', robotsHeader: '', error: err.message };
	} finally {
		clearTimeout(timer);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const asJson = args.includes('--json');
	const one = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
	const placements = one
		? [{ url: one, owner: 'ad hoc' }]
		: JSON.parse(readFileSync(LIST, 'utf8')).placements;

	const results = [];
	for (const p of placements) {
		const page = await fetchPage(p.url);
		if (!page.ok) {
			results.push({ ...p, status: 'blocked', code: page.code, error: page.error });
			continue;
		}
		results.push({ ...p, code: page.code, ...classifyPage({ url: p.url, html: page.html, robotsHeader: page.robotsHeader }) });
	}

	if (asJson) {
		process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
		return;
	}

	const order = ['followed', 'unlinked', 'nofollow', 'gone', 'blocked'];
	const label = {
		followed: 'Followed (counts toward DR)',
		unlinked: 'Unlinked mentions (ask for a link)',
		nofollow: 'Nofollow only (no DR value)',
		gone: 'No longer mentions three.ws',
		blocked: 'Fetch refused (check by hand)',
	};
	for (const status of order) {
		const rows = results.filter((r) => r.status === status);
		if (!rows.length) continue;
		console.log(`\n${label[status]}: ${rows.length}`);
		for (const r of rows) {
			const extra =
				status === 'followed'
					? `  -> ${r.followedTargets.join(', ')}`
					: status === 'blocked'
						? `  (HTTP ${r.code || r.error})`
						: '';
			console.log(`  ${r.owner}: ${r.url}${extra}`);
		}
	}
	const followedHosts = new Set(results.filter((r) => r.status === 'followed').map((r) => new URL(r.url).hostname));
	console.log(`\nFollowed referring hosts: ${followedHosts.size} (${[...followedHosts].join(', ') || 'none'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
