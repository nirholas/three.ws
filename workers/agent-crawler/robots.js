// robots.txt and per-domain politeness. robots.txt is fetched once per origin
// and honored, including Crawl-delay, under the crawler's own product token.

import robotsParser from 'robots-parser';
import { BOT_TOKEN, guardedFetch } from './guard.js';

const robotsCache = new Map(); // origin -> { robots, at, ttl }
const ROBOTS_TTL_MS = 60 * 60_000;
// An unreachable or failing server is retried sooner than a real answer.
const ROBOTS_FAIL_TTL_MS = 10 * 60_000;

async function robotsFor(origin) {
	const hit = robotsCache.get(origin);
	if (hit && Date.now() - hit.at < hit.ttl) return hit.robots;
	const robotsUrl = `${origin}/robots.txt`;
	let body = '';
	let ttl = ROBOTS_TTL_MS;
	try {
		const res = await guardedFetch(robotsUrl, { timeoutMs: 6000, headers: { accept: 'text/plain' } });
		// RFC 9309: 4xx means no rules; 5xx or a network failure means "assume
		// disallowed for now" so a struggling server is not crawled harder.
		if (res.status >= 500) { body = 'User-agent: *\nDisallow: /'; ttl = ROBOTS_FAIL_TTL_MS; }
		else if (res.ok) body = (await res.text()).slice(0, 500_000);
	} catch {
		body = 'User-agent: *\nDisallow: /';
		ttl = ROBOTS_FAIL_TTL_MS;
	}
	const robots = robotsParser(robotsUrl, body);
	robotsCache.set(origin, { robots, at: Date.now(), ttl });
	if (robotsCache.size > 3000) robotsCache.delete(robotsCache.keys().next().value);
	return robots;
}

// { allowed, delayMs } for one URL under the crawler's token.
export async function robotsCheck(url) {
	const u = new URL(url);
	const robots = await robotsFor(u.origin);
	const allowed = robots.isAllowed(u.href, BOT_TOKEN) !== false;
	const delay = Number(robots.getCrawlDelay(BOT_TOKEN));
	return { allowed, delayMs: Number.isFinite(delay) && delay > 0 ? Math.min(delay, 30) * 1000 : 0 };
}

// Synchronous answer from the cache only: false when a cached robots.txt
// refuses the URL, true when it allows it, null when the origin is unknown.
// Lets the crawler purge every queued link a site already refused without
// visiting them one by one.
export function robotsAllowsCached(url) {
	let u;
	try { u = new URL(url); } catch { return null; }
	const hit = robotsCache.get(u.origin);
	if (!hit || Date.now() - hit.at >= hit.ttl) return null;
	return hit.robots.isAllowed(u.href, BOT_TOKEN) !== false;
}

// Per-domain politeness shared by every crawler in the process: at most one
// request to a domain every gapMs (or its robots Crawl-delay, if longer).
const domainNext = new Map();

export function domainReadyIn(host) {
	return Math.max(0, (domainNext.get(host) || 0) - Date.now());
}

export function claimDomain(host, gapMs) {
	domainNext.set(host, Date.now() + gapMs);
	if (domainNext.size > 10_000) {
		const now = Date.now();
		for (const [h, t] of domainNext) if (t < now) domainNext.delete(h);
	}
}
