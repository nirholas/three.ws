// Extra lanes for the article extraction ladder (api/_lib/article-extract.js).
// ---------------------------------------------------------------------------
// When the publisher page and the reader service both come back empty, these
// lanes recover the story from places we may lawfully read:
//
//   wayback  , the Internet Archive's closest snapshot of the same URL. It
//               carries the full body of a story that has since gone behind a
//               paywall or been taken down.
//   primary  , the SEC EDGAR filing (8-K press-release exhibit, 10-K, 10-Q,
//               S-1) of the company the headline names. Public-domain primary
//               source, fetched with the contact User-Agent SEC requires and
//               throttled below its 10 requests/second ceiling.
//   siblings , other outlets covering the same story, from the native feed
//               aggregator. Each contributes only its own bounded feed
//               description, attributed by name.
//
// Every network fetch goes through the shared SSRF guard (fetchSafePublicUrlPinned
// validates all DNS answers, pins the socket, re-validates every redirect hop).
// Siblings reads the in-process feed cache and fetches nothing. Whatever a lane
// returns still passes through the standing excerpt limit in news-rights.js at
// the HTTP boundary, same as every other rung.

import { assertSafePublicUrl, fetchSafePublicUrlPinned } from './ssrf-guard.js';
import { getNews } from './news.js';
import { excerptText, isSuppressed } from './news-rights.js';

const LANE_TIMEOUT_MS = 10_000;
const MAX_LANE_BYTES = 5 * 1024 * 1024;

// SEC fair-access policy: a descriptive User-Agent with a contact address, and
// no more than 10 requests per second.
const SEC_CONTACT = (process.env.SEC_CONTACT_EMAIL || 'support@three.ws').trim();
export const LANE_USER_AGENT = `three.ws news reader ${SEC_CONTACT}`;
const SEC_MIN_INTERVAL_MS = 125; // 8 requests/second, under the 10/s ceiling

const STOPWORDS = new Set(
	('a an the and or of to in on at for with by from as is are was were be been it its this that these those ' +
		'after before over under into about how why what who when will would could should says said say new ' +
		'more most than not no up down out off has have had can may').split(/\s+/),
);

// ── Shared helpers ─────────────────────────────────────────────────────────

function words(text) {
	return String(text || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

async function fetchText(url, headers, accept) {
	const resp = await fetchSafePublicUrlPinned(
		url,
		{ headers, signal: AbortSignal.timeout(LANE_TIMEOUT_MS) },
		{ maxBytes: MAX_LANE_BYTES },
	);
	if (!resp.ok) throw Object.assign(new Error(`${new URL(url).hostname} responded ${resp.status}`), { status: resp.status });
	const type = resp.headers.get('content-type') || '';
	if (!accept.some((a) => type.includes(a))) {
		throw new Error(`unsupported content type: ${type.split(';')[0] || 'unknown'}`);
	}
	return resp.text();
}

// ── Wayback ────────────────────────────────────────────────────────────────

/**
 * Turn the availability API's `closest` snapshot into the raw-capture URL
 * (`id_` serves the archived bytes without the Wayback toolbar rewrite).
 * Returns null unless the snapshot is genuinely a web.archive.org capture.
 */
export function waybackRawUrl(closest, originalUrl) {
	if (!closest?.available || !/^\d{14}$/.test(String(closest.timestamp))) return null;
	let snap;
	try {
		snap = new URL(String(closest.url).replace(/^http:/, 'https:'));
	} catch {
		return null;
	}
	if (snap.hostname !== 'web.archive.org' || !snap.pathname.startsWith('/web/')) return null;
	return `https://web.archive.org/web/${closest.timestamp}id_/${originalUrl}`;
}

export async function fetchViaWayback(url, extractParagraphs) {
	await assertSafePublicUrl(url, { allowHttp: true });
	const lookup = await fetchText(
		`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
		{ accept: 'application/json', 'user-agent': LANE_USER_AGENT },
		['json'],
	);
	const raw = waybackRawUrl(JSON.parse(lookup)?.archived_snapshots?.closest, url);
	if (!raw) return { paragraphs: [], snapshot: null };
	const html = await fetchText(
		raw,
		{ accept: 'text/html,application/xhtml+xml', 'user-agent': LANE_USER_AGENT },
		['text/html', 'application/xhtml+xml'],
	);
	return { paragraphs: extractParagraphs(html), snapshot: raw };
}

// ── Primary documents: SEC EDGAR ───────────────────────────────────────────

let secLastAt = 0;
let secQueue = Promise.resolve();

/** Serialise EDGAR requests at least SEC_MIN_INTERVAL_MS apart. */
function secSlot() {
	const turn = secQueue.then(async () => {
		const wait = secLastAt + SEC_MIN_INTERVAL_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		secLastAt = Date.now();
	});
	secQueue = turn.catch(() => {});
	return turn;
}

const filingCache = new Map(); // accession -> paragraphs
const FILING_CACHE_MAX = 128;

/**
 * The company or organisation a headline names: the longest run of capitalised
 * words that is not the sentence-initial word alone. Null when the headline
 * names nobody a filing could be matched to.
 */
export function filerPhrase(title) {
	const runs = [...String(title || '').matchAll(/\b[A-Z][\p{L}\p{N}&.'-]+(?:\s+(?:of\s+)?[A-Z][\p{L}\p{N}&.'-]+)*/gu)]
		.map((m) => m[0].trim())
		.filter((r) => r.length >= 4 && !STOPWORDS.has(r.toLowerCase()));
	if (!runs.length) return null;
	runs.sort((a, b) => b.length - a.length);
	const best = runs[0];
	// A lone sentence-opening word ("Bitcoin") is a topic, not a filer.
	const isFirstWordOnly = !/\s/.test(best) && String(title).trimStart().startsWith(best);
	return isFirstWordOnly ? null : best;
}

/**
 * Pick the best document hit from an EDGAR full-text search response: the
 * filer's display name must contain the headline phrase (so a loose full-text
 * match on a common word never yields an unrelated company's filing), and a
 * press-release exhibit beats the bare form.
 *
 * @returns {{ url: string, accession: string, form: string, filer: string, filed: string } | null}
 */
export function pickFiling(response, phrase) {
	const need = String(phrase || '').toLowerCase();
	let best = null;
	for (const hit of response?.hits?.hits || []) {
		const s = hit?._source || {};
		const [accession, file] = String(hit?._id || '').split(':');
		const cik = String(s.ciks?.[0] || '').replace(/^0+/, '');
		const filer = String(s.display_names?.[0] || '');
		if (!accession || !file || !cik || !need || !filer.toLowerCase().includes(need)) continue;
		if (!/\.html?$/i.test(file)) continue;
		const rank = s.file_type === 'EX-99.1' ? 2 : s.file_type === s.form ? 1 : 0;
		if (!rank) continue;
		if (!best || rank > best.rank) {
			best = {
				rank,
				url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/${file}`,
				accession,
				form: String(s.form || ''),
				filer: filer.replace(/\s*\(CIK[^)]*\)\s*$/, '').trim(),
				filed: String(s.file_date || ''),
			};
		}
	}
	if (!best) return null;
	const { rank, ...filing } = best;
	return filing;
}

export async function fetchPrimaryFiling(title, publishedAt, extractParagraphs, now = Date.now()) {
	const phrase = filerPhrase(title);
	if (!phrase) return { paragraphs: [], filing: null };

	const end = new Date(now);
	const published = Date.parse(publishedAt || '');
	const start = new Date((Number.isFinite(published) ? published : now) - 14 * 86_400_000);
	const day = (d) => d.toISOString().slice(0, 10);
	const search =
		`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${phrase}"`)}` +
		`&forms=8-K,10-K,10-Q,S-1&dateRange=custom&startdt=${day(start)}&enddt=${day(end)}`;

	await secSlot();
	const found = JSON.parse(await fetchText(search, { accept: 'application/json', 'user-agent': LANE_USER_AGENT }, ['json']));
	const filing = pickFiling(found, phrase);
	if (!filing) return { paragraphs: [], filing: null };

	let paragraphs = filingCache.get(filing.accession + filing.url);
	if (!paragraphs) {
		await secSlot();
		const html = await fetchText(filing.url, { accept: 'text/html', 'user-agent': LANE_USER_AGENT }, ['text/html']);
		paragraphs = extractParagraphs(html);
		if (filingCache.size >= FILING_CACHE_MAX) filingCache.delete(filingCache.keys().next().value);
		filingCache.set(filing.accession + filing.url, paragraphs);
	}
	return { paragraphs, filing };
}

// ── Sibling coverage ───────────────────────────────────────────────────────

const MIN_SHARED_WORDS = 3;
const MIN_OVERLAP = 0.4;

/**
 * Other outlets' coverage of the same story: feed items whose headline shares
 * enough distinctive words with ours, from a different publisher, newest
 * first. Pure so it can be tested without the aggregator.
 */
export function pickSiblings(candidates, { title, url, max = 4 }) {
	const mine = new Set(words(title));
	if (mine.size < MIN_SHARED_WORDS) return [];
	let myHost = '';
	try {
		myHost = new URL(url).hostname.replace(/^www\./, '');
	} catch {
		/* url validated upstream */
	}
	const seenSources = new Set();
	const out = [];
	for (const c of candidates || []) {
		if (!c?.link || c.link === url || isSuppressed(c)) continue;
		let host = '';
		try {
			host = new URL(c.link).hostname.replace(/^www\./, '');
		} catch {
			continue;
		}
		if (host === myHost || seenSources.has(host)) continue;
		const theirs = new Set(words(c.title));
		const shared = [...theirs].filter((w) => mine.has(w)).length;
		if (shared < MIN_SHARED_WORDS || shared / Math.min(mine.size, theirs.size) < MIN_OVERLAP) continue;
		const body = excerptText(c.description);
		if (body.length < 60) continue;
		seenSources.add(host);
		out.push({ source: c.source || host, link: c.link, text: body });
		if (out.length >= max) break;
	}
	return out;
}

export async function fetchSiblings(title, url) {
	const pool = await getNews({ limit: 300, lang: 'all' });
	const siblings = pickSiblings(pool.articles, { title, url });
	return {
		paragraphs: siblings.map((s) => `${s.source} reports: ${s.text}`),
		siblings: siblings.map(({ source, link }) => ({ source, link })),
	};
}
