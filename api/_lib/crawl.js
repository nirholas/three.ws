// The Crawl: pure helpers shared by the API (api/crawl/[action].js), the worker
// (workers/agent-crawler) and the tests. Nothing here touches the network, the
// database or Redis, so every boundary rule (what a pushed step may carry, what a
// mission may name, how a URL is keyed) is unit-testable and identical on both
// sides of the wire.

import { createHash } from 'node:crypto';

export const CRAWL_LIVE_TTL = 75; // seconds a crawler stays "awake" after its last push
export const CRAWL_ACTIVE_WINDOW_MS = 90_000;
export const MAX_LINKS = 48;
export const MAX_TEXT_CHARS = 120_000;
export const GIST_MAX = 480;
export const TITLE_MAX = 200;
export const THOUGHT_MAX = 240;
export const TOPIC_MIN = 2;
export const TOPIC_MAX = 120;
export const MAX_SEEDS = 8;
export const FRAME_B64_MAX = 700_000; // ~520 KB JPEG
export const CHARS_PER_TOKEN = 4;

export const STEP_STATUSES = ['reading', 'walking', 'leaping', 'blocked', 'resting'];

// Tracking parameters that make the same page look like many. Stripped before a
// URL is hashed so the corpus dedupes on content, not on campaign tags.
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|ref|ref_src|_hs[a-z]+|igshid|si)$/i;

export function normalizeUrl(raw) {
	let u;
	try { u = new URL(String(raw)); } catch { return null; }
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	if (u.username || u.password) return null;
	u.hash = '';
	u.hostname = u.hostname.toLowerCase().replace(/\.$/, '');
	if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
	for (const k of [...u.searchParams.keys()]) {
		if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
	}
	u.searchParams.sort();
	if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
	return u.href;
}

export function urlHash(normalized) {
	return createHash('sha256').update(normalized).digest('hex');
}

export function domainOf(url) {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return '';
	}
}

export function estimateTokens(text) {
	return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// A visible link rectangle, in normalized viewport coordinates (0..1). The page
// renders the avatar walking to these, so a malformed rect must be dropped, never
// passed through to a client that would place a body off-canvas.
export function sanitizeLinkRect(link) {
	if (!link || typeof link !== 'object') return null;
	const x = clamp01(Number(link.x));
	const y = clamp01(Number(link.y));
	const w = clamp01(Number(link.w));
	const h = clamp01(Number(link.h));
	if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
	const out = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y), t: str(link.t, 80) };
	if (out.w <= 0 || out.h <= 0) return null;
	return out;
}

// The live step: what a crawler is doing right now. Lite on purpose (no image
// bytes): the fleet stream fans it out to every viewer on every change.
export function sanitizeStep(step) {
	if (!step || typeof step !== 'object') return null;
	const url = normalizeUrl(step.url);
	const links = Array.isArray(step.links)
		? step.links.slice(0, MAX_LINKS).map(sanitizeLinkRect).filter(Boolean)
		: [];
	const t = Number(step.target);
	const target = Number.isInteger(t) && t >= 0 && t < links.length ? t : null;
	const nextUrl = target != null ? normalizeUrl(step.nextUrl) : null;
	const status = STEP_STATUSES.includes(step.status) ? step.status : 'reading';
	const seq = Number(step.seq);
	return {
		url,
		domain: url ? domainOf(url) : '',
		title: str(step.title, TITLE_MAX),
		thought: str(step.thought, THOUGHT_MAX),
		status,
		links,
		target,
		nextUrl,
		seq: Number.isSafeInteger(seq) && seq >= 0 ? seq : 0,
		scrollY: clamp01(Number(step.scrollY)) ?? 0,
	};
}

// A finished page read: the corpus row. Text is bounded here so a runaway
// page cannot push megabytes through the API.
export function sanitizePage(page) {
	if (!page || typeof page !== 'object') return null;
	const url = normalizeUrl(page.url);
	if (!url) return null;
	const text = typeof page.text === 'string' ? page.text.slice(0, MAX_TEXT_CHARS) : '';
	const rel = Number(page.relevance);
	const linksOut = Number(page.linksOut);
	return {
		url,
		hash: urlHash(url),
		domain: domainOf(url),
		title: str(page.title, TITLE_MAX) || null,
		gist: str(page.gist, GIST_MAX) || null,
		text,
		tokens: estimateTokens(text),
		linksOut: Number.isSafeInteger(linksOut) && linksOut >= 0 ? Math.min(linksOut, 100_000) : 0,
		relevance: Number.isFinite(rel) ? Math.min(1, Math.max(0, rel)) : null,
		fromUrl: normalizeUrl(page.fromUrl),
	};
}

export function isFrameB64(s) {
	return typeof s === 'string' && s.length > 64 && s.length <= FRAME_B64_MAX && /^[A-Za-z0-9+/]+=*$/.test(s)
		&& s.startsWith('/9j/'); // JPEG magic (FF D8 FF) in base64
}

// Owner-set mission. Seeds must be public http(s) URLs; the worker re-guards every
// navigation against private hosts, this is the first fence at write time.
export function validateMission(body) {
	const topic = str(body?.topic, TOPIC_MAX + 1);
	if (topic.length < TOPIC_MIN || topic.length > TOPIC_MAX) {
		return { error: `topic must be ${TOPIC_MIN} to ${TOPIC_MAX} characters` };
	}
	const rawSeeds = Array.isArray(body?.seeds)
		? body.seeds
		: typeof body?.seeds === 'string' ? body.seeds.split(/[\s,]+/) : [];
	const seeds = [];
	for (const s of rawSeeds) {
		if (!s || typeof s !== 'string') continue;
		const withScheme = /^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim()}`;
		const n = normalizeUrl(withScheme);
		if (!n) return { error: `not a web address: ${s.slice(0, 80)}` };
		const host = new URL(n).hostname;
		if (isPrivateHostname(host)) return { error: `not a public address: ${host}` };
		if (!seeds.includes(n)) seeds.push(n);
		if (seeds.length > MAX_SEEDS) return { error: `at most ${MAX_SEEDS} start pages` };
	}
	return { topic, seeds, enabled: body?.enabled !== false };
}

// Static hostname screen (no DNS). Catches literals and the well-known internal
// names; the worker additionally resolves every host before it navigates.
export function isPrivateHostname(host) {
	const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
	if (!h || (!h.includes('.') && !h.includes(':'))) return true;
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
	if (h === 'metadata.google.internal' || h === 'metadata') return true;
	const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
			|| (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
	}
	if (h.includes(':')) {
		return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
	}
	return false;
}

// The memory an owner's agent keeps from a page it read, so its chat can recall
// it later ("what have you been reading about?").
export function pageMemory(page, topic) {
	const head = page.title ? `Read "${page.title}"` : 'Read a page';
	const body = page.gist ? `: ${page.gist}` : '.';
	return `${head} (${page.url}) while crawling for ${topic}${body}`.slice(0, 900);
}
