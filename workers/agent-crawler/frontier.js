// Link choice for one crawler: which page does the agent walk to next?
//
// Pure on purpose (no browser, no network) so the root test suite can pin the
// behavior: tests/agent-crawler-frontier.test.js. The crawler hands every link it
// measured on a page to scoreLink(), keeps the best candidates in a Frontier, and
// walks to the winner when it is on screen or leaps to it when it is not.

const STOPWORDS = new Set(
	('a an and are as at be but by for from has have how in into is it its of on or that the their this to was were what '
	+ 'when where which who why will with about after all also any can could did does each more most new not now our out '
	+ 'over so some such than them then there these they through up use used using very was way we you your').split(' '),
);

// Links a reading agent should never follow: account walls, carts, share
// intents, and anything that downloads instead of rendering.
const SKIP_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|cart|checkout|basket|account|my-account|subscribe|password|auth|oauth|wp-admin|wp-login)(\/|$|\?|\.)/i;
const SKIP_HOST = /(^|\.)(facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|t\.co|linkedin\.com|pinterest\.com|reddit\.com\/submit|accounts\.google\.com|doubleclick\.net|googleadservices\.com)$/i;
const SKIP_EXT = /\.(pdf|zip|gz|tgz|rar|7z|exe|dmg|msi|iso|apk|deb|rpm|jpg|jpeg|png|gif|webp|avif|svg|ico|bmp|tiff?|mp3|mp4|m4a|wav|ogg|webm|mov|avi|mkv|woff2?|ttf|otf|css|js|json|xml|rss|atom|csv|xlsx?|docx?|pptx?)$/i;
const SHARE = /(sharer|share\?|intent\/tweet|shareArticle|mailto:|javascript:|tel:|sms:|whatsapp:)/i;
const BOILERPLATE = /^(privacy|privacy policy|terms|terms of (use|service)|cookies?|cookie (policy|settings)|contact( us)?|careers|jobs|advertise|sitemap|accessibility|imprint|legal|help|faq|log ?in|sign ?(in|up)|subscribe|donate|skip to (main )?content|menu|search|home)$/i;

export const MAX_FRONTIER = 400;
export const MAX_PAGES_PER_DOMAIN = 30;

// Lowercase content words with a light suffix strip, so "crawlers" in a topic
// matches "crawler" in an anchor and "learning" matches "learn".
export function stem(word) {
	let w = word.toLowerCase();
	if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
	else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
	else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
	else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
	return w;
}

export function tokenize(text) {
	return String(text || '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 3 && !STOPWORDS.has(w))
		.map(stem);
}

export function topicTerms(topic) {
	return [...new Set(tokenize(topic))].slice(0, 16);
}

export function hostOf(url) {
	try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// Strip the fragment and tracking tags so the same article reached from two
// pages counts as one visit. Mirrors normalizeUrl in api/_lib/crawl.js closely
// enough for dedupe; the API re-normalizes authoritatively.
export function canonical(url) {
	let u;
	try { u = new URL(url); } catch { return null; }
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	if (u.username || u.password) return null;
	u.hash = '';
	for (const k of [...u.searchParams.keys()]) {
		if (/^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|ref|ref_src|igshid|si)$/i.test(k)) u.searchParams.delete(k);
	}
	u.searchParams.sort();
	if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
	return u.href;
}

export function isCrawlable(url) {
	if (!url || url.length > 400 || SHARE.test(url)) return false;
	let u;
	try { u = new URL(url); } catch { return false; }
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
	if (SKIP_HOST.test(u.hostname) || SKIP_HOST.test(`${u.hostname}${u.pathname}`)) return false;
	if (SKIP_PATH.test(u.pathname) || SKIP_EXT.test(u.pathname)) return false;
	return true;
}

// Fraction of topic terms present in a token list, 0..1.
export function coverage(terms, tokens) {
	if (!terms.length) return 0;
	const set = tokens instanceof Set ? tokens : new Set(tokens);
	let hit = 0;
	for (const t of terms) if (set.has(t)) hit += 1;
	return hit / terms.length;
}

// How close is a page to the topic? Title hits count double, and body density
// (term mentions per thousand words, saturating) separates a passing mention
// from a page that is about the thing.
export function relevance(terms, title, text) {
	if (!terms.length) return 0;
	const titleCov = coverage(terms, tokenize(title));
	const words = tokenize(String(text || '').slice(0, 40_000));
	if (!words.length) return Math.min(1, titleCov * 0.6);
	const termSet = new Set(terms);
	let mentions = 0;
	for (const w of words) if (termSet.has(w)) mentions += 1;
	const density = Math.min(1, (mentions / words.length) * 1000 / 25);
	const bodyCov = coverage(terms, words);
	return Math.round(Math.min(1, titleCov * 0.4 + bodyCov * 0.35 + density * 0.25) * 1000) / 1000;
}

// Score one link. ctx: { terms, fromHost, domainCounts: Map, visited: Set, rand }.
// Returns -Infinity for links that must never be followed.
export function scoreLink(link, ctx) {
	const url = canonical(link.href);
	if (!url || !isCrawlable(url) || ctx.visited.has(url)) return -Infinity;
	const host = hostOf(url);
	const seen = ctx.domainCounts.get(host) || 0;
	if (seen >= MAX_PAGES_PER_DOMAIN) return -Infinity;

	const text = String(link.text || '').trim();
	if (BOILERPLATE.test(text)) return -Infinity;

	const textTokens = tokenize(text);
	let pathTokens = [];
	try { pathTokens = tokenize(decodeURIComponent(new URL(url).pathname.replace(/[-_/.]+/g, ' '))); } catch { pathTokens = []; }

	const textHits = ctx.terms.filter((t) => textTokens.includes(t)).length;
	const pathHits = ctx.terms.filter((t) => pathTokens.includes(t)).length;
	let score = textHits * 3 + pathHits * 1.5;

	// Descriptive anchors beat "click here" and bare icons.
	if (text.length >= 12 && text.length <= 120) score += 0.6;
	else if (!text) score -= 0.8;

	const sameHost = host === ctx.fromHost;
	if (sameHost) score += 0.4;
	else if (seen === 0 && (textHits || pathHits)) score += 1.2; // a relevant new site widens the corpus
	else if (seen === 0) score += 0.3;
	score -= seen * 0.08; // wear off a domain gradually

	// Prefer article-shaped paths over hubs and query soups.
	const depth = pathTokens.length;
	if (depth >= 2 && depth <= 10) score += 0.3;
	if (url.includes('?') && url.split('&').length > 3) score -= 0.6;

	if (link.visible) score += 0.25; // the agent can walk to it on this screen
	return score + (ctx.rand ? ctx.rand() * 0.35 : 0);
}

// A bounded best-first queue of URLs, deduped by canonical URL.
export class Frontier {
	constructor(max = MAX_FRONTIER) {
		this.max = max;
		this.items = new Map(); // url -> { url, score, from, text }
	}

	get size() { return this.items.size; }

	add(url, score, from = null, text = '') {
		const key = canonical(url);
		if (!key || !Number.isFinite(score)) return false;
		const prev = this.items.get(key);
		if (prev && prev.score >= score) return false;
		this.items.set(key, { url: key, score, from, text });
		if (this.items.size > this.max) this.trim();
		return true;
	}

	trim() {
		const sorted = [...this.items.values()].sort((a, b) => b.score - a.score).slice(0, this.max);
		this.items = new Map(sorted.map((i) => [i.url, i]));
	}

	// Highest-scoring entry that passes the filter (e.g. not visited, not cooling
	// down). Entries that fail are left in place for a later turn.
	pop(accept = () => true) {
		let best = null;
		for (const item of this.items.values()) {
			if (!accept(item)) continue;
			if (!best || item.score > best.score) best = item;
		}
		if (best) this.items.delete(best.url);
		return best;
	}

	drop(url) { this.items.delete(canonical(url)); }

	// Decay everything a little each turn so stale hopes from fifty pages ago
	// lose to fresh leads from the page the agent is actually standing on.
	decay(factor = 0.97) {
		for (const item of this.items.values()) item.score *= factor;
	}
}

// Extractive gist: the first few real sentences, preferring ones that mention
// the topic. No model call, so it is free, deterministic, and never invents.
export function gistOf(text, terms, max = 480) {
	// Lines are block boundaries (readPage puts one per paragraph), so a menu
	// crumb on its own line never glues onto the first real sentence.
	const sentences = String(text || '')
		.split(/\n+/)
		.flatMap((line) => line.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
		.map((s) => s.trim())
		.filter((s) => s.length >= 40 && s.length <= 400 && /[a-z]/.test(s) && (s.match(/\s/g) || []).length >= 5)
		.slice(0, 40);
	if (!sentences.length) return '';
	const termSet = new Set(terms);
	const ranked = sentences.map((s, i) => {
		const hits = tokenize(s).filter((t) => termSet.has(t)).length;
		return { s, i, rank: hits * 2 - i * 0.15 };
	});
	const picked = ranked.sort((a, b) => b.rank - a.rank).slice(0, 3).sort((a, b) => a.i - b.i);
	let out = '';
	for (const { s } of picked) {
		if ((out ? out.length + 1 : 0) + s.length > max) break;
		out = out ? `${out} ${s}` : s;
	}
	return out || sentences[0].slice(0, max);
}

// What the agent "says" on its card. Deterministic phrasing from what it is
// really doing; no model is asked to narrate.
export function thoughtFor(kind, d = {}) {
	const quote = (s, n = 70) => {
		const t = String(s || '').replace(/\s+/g, ' ').trim();
		return t.length > n ? `${t.slice(0, n - 1)}…` : t;
	};
	switch (kind) {
		case 'reading':
			return d.relevance >= 0.35
				? `Reading "${quote(d.title)}" on ${d.domain}. This is squarely about ${d.topic}.`
				: d.relevance >= 0.12
					? `Reading "${quote(d.title)}" on ${d.domain}. Some of this touches ${d.topic}.`
					: `Passing through ${d.domain}. Not much about ${d.topic} here.`;
		case 'walking':
			return d.text
				? `Walking to "${quote(d.text, 60)}"${d.offsite ? `, off to ${d.host}` : ''}.`
				: `Walking to a link${d.offsite ? ` on ${d.host}` : ''}.`;
		case 'leaping':
			return d.text ? `Leaping to "${quote(d.text, 60)}" from my list.` : `Leaping to ${d.host} from my list.`;
		case 'blocked':
			return `${d.host} ${d.reason || 'turned me away'}. Finding another way.`;
		case 'resting':
			return d.reason || 'Out of leads. Looking for new start pages.';
		default:
			return '';
	}
}
