// Multi-source web search with fallback chain.
// Priority: Vertex-grounded Google Search → Brave → Tavily → Exa → Serper →
// Wikipedia full-text search → DuckDuckGo instant answer.
// At least 3 results are always returned (or a descriptive error thrown).

import { webSearchAvailable, groundedSearch } from '../../../api/_lib/web-search.js';

const TIMEOUT_MS = 10_000;

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`Search timed out after ${ms}ms`)), ms),
		),
	]);
}

// Resolve to `fallback` if `promise` has not settled within `ms`. Unlike
// withTimeout this never rejects: it is for work whose result is an improvement
// on an answer the caller already holds, so running out of time is not an error.
function withDeadline(promise, ms, fallback) {
	let timer;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((resolve) => {
			timer = setTimeout(() => resolve(fallback), ms);
			timer.unref?.();
		}),
	]);
}

// How long the Wikipedia rung may spend widening its intros into article bodies
// when the caller set no deadline of its own.
const BODY_WIDEN_MS = 6_000;

// Headroom left between the end of widening and the caller's own cutoff. Without
// it the rung finishes at the exact moment searchAll stops waiting, so the race
// is a coin flip and the intros it already had are thrown away. With under this
// much time left there is no room to widen at all: return what is in hand.
const WIDEN_RESERVE_MS = 500;

// ── Vertex-grounded Google Search (keyless, GCP service-account auth) ────────
//
// The one rung that works in production today: no Brave/Tavily/Exa/Serper key
// is configured there, so without this the chain fell straight through to the
// Wikipedia/DuckDuckGo fallbacks. Rides Gemini on Vertex AI with the built-in
// google_search tool (api/_lib/web-search.js), gated on webSearchAvailable()
// (GOOGLE_CLOUD_PROJECT) exactly like the key rungs gate on their env keys.
//
// Shape note: grounding chunks carry title + url but no per-source snippet.
// The synthesized answer IS the evidence text Google grounded on these
// sources, so it becomes each result's snippet: the fact-check consumer
// (api/x402/fact-check.js) feeds snippet.slice(0, 900) to stance extraction
// and falls back to snippet.slice(0, 200) for the excerpt, both of which want
// claim-relevant prose, not a bare domain.
//
// AUTHORITY TRAP (verified against a live response 2026-07-29): a grounding
// chunk's `uri` is NOT the publisher URL — it is an opaque
// vertexaisearch.cloud.google.com/grounding-api-redirect/... link that Google
// requires for attribution. Scoring that URL means authorityScore() parses the
// hostname `vertexaisearch.cloud.google.com` for EVERY result, so a .gov, a
// Wikipedia page and an anonymous blog all collapse to the same unknown-domain
// default and domain authority silently stops working. The chunk carries the
// real publisher host separately as `domain`, so each result also exposes
// `domain` and the consumer scores that (api/x402/fact-check.js). `url` stays
// the redirect because it is the only link Google guarantees resolves.
async function searchVertexGrounded(query) {
	if (!webSearchAvailable()) return null;

	// groundedSearch enforces its own 20s abort (LLM synthesis regularly needs
	// more than the flat-HTTP TIMEOUT_MS the other rungs use).
	const { answer, sources } = await groundedSearch(query, { maxSources: 10 });
	const snippet = String(answer || '').trim();
	return sources.map((s) => ({
		url: s.url,
		domain: s.domain || '',
		title: s.title || s.domain || '',
		snippet: snippet || s.domain || '',
	}));
}

// ── Brave Search ──────────────────────────────────────────────────────────────

async function searchBrave(query) {
	const key = process.env.BRAVE_API_KEY;
	if (!key) return null;

	const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
	const res = await withTimeout(
		fetch(url, {
			headers: {
				'accept': 'application/json',
				'accept-encoding': 'gzip',
				'X-Subscription-Token': key,
			},
		}),
		TIMEOUT_MS,
	);
	if (!res.ok) {
		throw new Error(`Brave search HTTP ${res.status}`);
	}
	const data = await res.json();
	const results = data?.web?.results || [];
	return results.map((r) => ({
		url: r.url,
		title: r.title || '',
		snippet: r.description || r.extra_snippets?.[0] || '',
	}));
}

// ── Tavily ────────────────────────────────────────────────────────────────────

async function searchTavily(query) {
	const key = process.env.TAVILY_API_KEY;
	if (!key) return null;

	const res = await withTimeout(
		fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				api_key: key,
				query,
				max_results: 10,
				search_depth: 'basic',
			}),
		}),
		TIMEOUT_MS,
	);
	if (!res.ok) {
		throw new Error(`Tavily search HTTP ${res.status}`);
	}
	const data = await res.json();
	const results = data?.results || [];
	return results.map((r) => ({
		url: r.url,
		title: r.title || '',
		snippet: r.content || '',
	}));
}

// ── Exa ───────────────────────────────────────────────────────────────────────

async function searchExa(query) {
	const key = process.env.EXA_API_KEY;
	if (!key) return null;

	const res = await withTimeout(
		fetch('https://api.exa.ai/search', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-api-key': key,
			},
			body: JSON.stringify({ query, numResults: 10, useAutoprompt: true }),
		}),
		TIMEOUT_MS,
	);
	if (!res.ok) {
		throw new Error(`Exa search HTTP ${res.status}`);
	}
	const data = await res.json();
	const results = data?.results || [];
	return results.map((r) => ({
		url: r.url,
		title: r.title || '',
		snippet: r.text ? r.text.slice(0, 400) : '',
	}));
}

// ── Serper (Google SERP) ──────────────────────────────────────────────────────

async function searchSerper(query) {
	const key = process.env.SERPER_API_KEY;
	if (!key) return null;

	const res = await withTimeout(
		fetch('https://google.serper.dev/search', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'X-API-KEY': key,
			},
			body: JSON.stringify({ q: query, num: 10 }),
		}),
		TIMEOUT_MS,
	);
	if (!res.ok) {
		throw new Error(`Serper search HTTP ${res.status}`);
	}
	const data = await res.json();
	const results = data?.organic || [];
	return results.map((r) => ({
		url: r.link,
		title: r.title || '',
		snippet: r.snippet || '',
	}));
}

// ── Wikipedia full-text search (free, keyless fallback) ───────────────────────
//
// No BRAVE_API_KEY/TAVILY_API_KEY/EXA_API_KEY/SERPER_API_KEY is configured
// anywhere in this deployment (verified against the production Cloud Run env
// on 2026-07-08), so DuckDuckGo's Instant Answer API — which only resolves a
// near-exact entity name to a single Wikipedia abstract, not general full-text
// search — was the ONLY source, and it returns nothing for most LLM-generated,
// full-sentence search queries ("Does cracking your knuckles cause arthritis"
// finds no Instant Answer, even though English Wikipedia has directly relevant
// coverage). Wikipedia's own search API (`list=search`) does real full-text
// ranking over sentence-shaped queries and needs no API key or account, so it
// sits ahead of the DDG fallback: strictly more capable, same zero-config cost.
// Terms carried by nearly every sentence, so their presence says nothing about
// whether a paragraph is about the claim. Kept deliberately small: an aggressive
// stopword list starts deleting the words that make a claim specific ("not",
// "most", "all" are load-bearing in "You lose MOST of your body heat...").
const PASSAGE_STOPWORDS = new Set([
	'and', 'are', 'but', 'for', 'from', 'had', 'has', 'have', 'its', 'that',
	'the', 'their', 'them', 'they', 'this', 'was', 'were', 'what', 'when', 'which',
	'who', 'will', 'with', 'you', 'your',
]);

// A plaintext extract is bounded before scoring so one outlier article (the
// English "Napoleon" page is ~150 KB of plaintext) cannot dominate the CPU of a
// budgeted fact-check request. Truncation only ever costs late-article prose,
// which the search ranking already considers least relevant.
const MAX_EXTRACT_CHARS = 200_000;

// Sections that hold apparatus rather than assertions. Their entries match query
// terms readily (titles repeat the subject) and support no stance at all.
const NON_PROSE_SECTIONS = new Set([
	'bibliography', 'citations', 'external links', 'footnotes', 'further reading',
	'notes', 'references', 'see also', 'sources', 'works cited',
]);

function passageTerms(query) {
	return new Set(
		String(query)
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((t) => t.length >= 3 && !PASSAGE_STOPWORDS.has(t)),
	);
}

/**
 * Pick the paragraphs of a plaintext Wikipedia extract that actually discuss
 * `query`, most relevant first, capped at `maxChars`.
 *
 * Why this exists: `exintro=1` returned only an article's lead section, which
 * states what the page is ABOUT rather than the attribute a claim asserts. On
 * 2026-09-09 the live chain answered "Napoleon Bonaparte was unusually short"
 * with the lead paragraphs of "Napoleon", "Napoleon III" and "Napoleonic Wars",
 * none of which mention height at all: every stance came back "neutral" and the
 * verdict was "insufficient", while the height discussion sat in the article
 * BODY the whole time. Ranking body paragraphs by how much of the claim's own
 * vocabulary they carry recovers that prose.
 *
 * A paragraph that scores nothing is not evidence, so when no paragraph matches
 * this falls back to the leading prose, which is exactly the old behaviour.
 *
 * @param {string} extract  Plaintext extract (MediaWiki `explaintext` output).
 * @param {string} query    The search query the passage should be relevant to.
 * @param {{ maxChars?: number }} [opts]
 * @returns {string} Selected passages joined by blank lines.
 */
export function selectRelevantPassages(extract, query, { maxChars = 1200 } = {}) {
	const text = String(extract || '').slice(0, MAX_EXTRACT_CHARS).trim();
	if (!text) return '';

	const terms = passageTerms(query);

	// Plaintext extracts separate paragraphs with blank lines and render section
	// titles as "== Heading ==". Headings are not prose, but they name the
	// context a body paragraph sits in, so they are carried as a prefix instead
	// of being emitted as passages of their own. A heading is not reliably
	// surrounded by blank lines, so it is forced onto its own block first;
	// without that, "== Gustatory system ==" rides inside the paragraph above it
	// and the section prefix names the wrong part of the article.
	const blocks = [];
	let section = '';
	const paragraphs = text.replace(/\n(=+[^\n=][^\n]*?=+)\n/g, '\n\n$1\n\n').split(/\n\s*\n/);
	for (const raw of paragraphs) {
		const block = raw.trim();
		if (!block) continue;
		const heading = block.match(/^=+\s*(.+?)\s*=+$/);
		if (heading) {
			section = heading[1];
			continue;
		}
		// An apparatus section is citations, not claims: a Bibliography entry can
		// carry every term in the query (a book titled "The Great Wall of China")
		// while asserting nothing a stance judgment can read.
		if (NON_PROSE_SECTIONS.has(section.trim().toLowerCase())) continue;
		blocks.push({ text: block, section, index: blocks.length });
	}
	if (!blocks.length) return '';

	// Term counts per paragraph, and the number of paragraphs each term appears
	// in, so scoring can weight by how discriminative a term is WITHIN this
	// article. Plain distinct-term coverage ties constantly (in the "Tongue"
	// article almost every paragraph says "tongue" and "taste") and the tie then
	// resolves to document order, which hands the win to the lead every time.
	const docFreq = new Map();
	for (const block of blocks) {
		block.counts = new Map();
		for (const word of block.text.toLowerCase().split(/[^a-z0-9]+/)) {
			if (!terms.has(word)) continue;
			block.counts.set(word, (block.counts.get(word) || 0) + 1);
		}
		for (const term of block.counts.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
	}

	// Textbook TF-IDF over the article's own paragraphs. A term carried by every
	// paragraph earns almost nothing; the rare term that makes the claim specific
	// ("map" in an article about the tongue) is what pulls the right passage up.
	const total = blocks.length;
	for (const block of blocks) {
		let score = 0;
		for (const [term, count] of block.counts) {
			const idf = Math.log(1 + total / (docFreq.get(term) || 1));
			score += idf * (1 + Math.log(count));
		}
		block.score = score;
		block.matched = block.counts.size;
	}

	const scored = blocks.filter((b) => b.matched > 0);
	// A single incidental term is a mention, not a discussion of the claim, so a
	// multi-term paragraph outranks a one-term paragraph whatever its TF-IDF
	// weight. Below that, best weight first, and the article's own order breaks
	// exact ties so the lead stays ahead of a late aside that matches equally.
	scored.sort(
		(a, b) =>
			Number(b.matched > 1) - Number(a.matched > 1) ||
			b.score - a.score ||
			a.index - b.index,
	);
	const chosen = scored.length ? scored : blocks.slice(0, 2);

	const out = [];
	let used = 0;
	for (const block of chosen) {
		const prefix = block.section ? `${block.section}: ` : '';
		const piece = prefix + block.text;
		if (used && used + piece.length > maxChars) break;
		out.push(piece);
		used += piece.length + 2;
		if (used >= maxChars) break;
	}
	return out.join('\n\n').slice(0, maxChars).trim();
}

async function searchWikipedia(query, { deadline = 0 } = {}) {
	// generator=search + prop=extracts fetches the ranked pages AND their text in
	// ONE request. The old list=search call only returned the ~150-char
	// search-match snippet (the bolded fragment around the keyword hit), which
	// rarely contains the fact being checked — downstream stance extraction
	// marked nearly every such source "neutral" and the whole chain collapsed to
	// "mixed" (the 20% benchmark run of 2026-07-08).
	//
	// `exintro=1` was the 2026-07-08 answer to that and overcorrected: an intro
	// states what a page is about, so it carries the fact only when the claim is
	// about the page's subject. Claims about an ATTRIBUTE ("Napoleon was
	// unusually short", "the tongue has taste zones") are covered in the body,
	// and the intro-only extract dropped exactly the prose the verdict needed.
	//
	// The ranked intros are still fetched in this one request, because MediaWiki
	// refuses whole-article extracts in bulk ("exlimit was too large for a whole
	// article extracts request, lowered to 1"), so a single no-exintro call would
	// return text for ONE page and an empty extract for the other four. The
	// intros are the guaranteed floor; fetchFullExtract then widens each page to
	// its body below, and anything that fails there degrades to the intro.
	const url =
		'https://en.wikipedia.org/w/api.php?action=query&generator=search' +
		`&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5` +
		'&prop=extracts&exintro=1&explaintext=1&exlimit=max&format=json&origin=*';
	const res = await withTimeout(
		fetch(url, { headers: { accept: 'application/json', 'user-agent': 'three.ws-fact-checker/1.0 (+https://three.ws)' } }),
		TIMEOUT_MS,
	);
	if (!res.ok) {
		throw new Error(`Wikipedia search HTTP ${res.status}`);
	}
	const data = await res.json();
	const pages = Object.values(data?.query?.pages || {});
	// generator results are unordered; `index` carries the search ranking.
	pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));

	// One whole-article request per ranked page, in parallel. These are cheap
	// CDN reads against a keyless API, and each one is independent: a rejected
	// page simply keeps the intro it already has.
	//
	// Widening is strictly best-effort. The intros above are already a complete,
	// returnable answer, so this step must never make the rung slower than the
	// answer it already holds: it gets whatever is left of the caller's deadline
	// and, when that runs out, every page falls back to its intro. Without that
	// bound a single hung body fetch spent the caller's whole search budget and
	// returned nothing, discarding intros that had arrived in milliseconds.
	const widenMs = deadline
		? Math.min(BODY_WIDEN_MS, deadline - Date.now() - WIDEN_RESERVE_MS)
		: BODY_WIDEN_MS;
	const bodies =
		widenMs > 0
			? await withDeadline(
					Promise.allSettled(pages.map((p) => fetchFullExtract(p.title))),
					widenMs,
					[],
				)
			: [];

	return pages.map((p, i) => {
		const intro = String(p.extract || '').trim().slice(0, 1200);
		// `bodies` is empty when widening was skipped or timed out, so every index
		// must tolerate being absent: an intro is always a valid answer here.
		const body = bodies[i]?.status === 'fulfilled' ? bodies[i].value : '';
		return {
			url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.title || '').replace(/ /g, '_'))}`,
			title: p.title || '',
			snippet: selectRelevantPassages(body, query) || intro,
		};
	}).filter((r) => r.snippet);
}

// Whole-article plaintext for one page. Separate from the search request because
// MediaWiki only serves a full extract one page at a time (see searchWikipedia).
async function fetchFullExtract(title) {
	const url =
		'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1' +
		`&titles=${encodeURIComponent(String(title))}&format=json&origin=*`;
	const res = await withTimeout(
		fetch(url, { headers: { accept: 'application/json', 'user-agent': 'three.ws-fact-checker/1.0 (+https://three.ws)' } }),
		TIMEOUT_MS,
	);
	if (!res.ok) {
		throw new Error(`Wikipedia extract HTTP ${res.status}`);
	}
	const data = await res.json();
	const page = Object.values(data?.query?.pages || {})[0];
	return String(page?.extract || '');
}

// ── DuckDuckGo instant answer (fallback) ──────────────────────────────────────

async function searchDuckDuckGo(query) {
	const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&t=threews`;
	const res = await withTimeout(fetch(url, { headers: { accept: 'application/json' } }), TIMEOUT_MS);
	if (!res.ok) {
		throw new Error(`DuckDuckGo HTTP ${res.status}`);
	}
	const data = await res.json();

	const results = [];

	if (data.AbstractURL && data.Abstract) {
		results.push({
			url: data.AbstractURL,
			title: data.Heading || query,
			snippet: data.Abstract,
		});
	}

	for (const r of data.RelatedTopics || []) {
		if (r.FirstURL && r.Text) {
			results.push({ url: r.FirstURL, title: r.Text.slice(0, 80), snippet: r.Text });
		}
		// Nested subtopics.
		if (Array.isArray(r.Topics)) {
			for (const t of r.Topics) {
				if (t.FirstURL && t.Text) {
					results.push({ url: t.FirstURL, title: t.Text.slice(0, 80), snippet: t.Text });
				}
			}
		}
	}

	for (const r of data.Results || []) {
		if (r.FirstURL && r.Text) {
			results.push({ url: r.FirstURL, title: r.Text.slice(0, 80), snippet: r.Text });
		}
	}

	return results.slice(0, 10);
}

// ── Deduplicate by URL ────────────────────────────────────────────────────────

function deduplicate(results) {
	const seen = new Set();
	return results.filter((r) => {
		if (!r.url || seen.has(r.url)) return false;
		seen.add(r.url);
		return true;
	});
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run multi-source search. Uses up to 2 sources in parallel if multiple keys
 * are configured, falling back through the chain until at least 3 results are
 * collected.
 *
 * @param {string} query
 * @returns {Promise<Array<{url: string, title: string, snippet: string}>>}
 */
export async function searchWeb(query, { deadline = 0 } = {}) {
	const hasVertex = webSearchAvailable();
	const hasBrave = Boolean(process.env.BRAVE_API_KEY);
	const hasTavily = Boolean(process.env.TAVILY_API_KEY);
	const hasExa = Boolean(process.env.EXA_API_KEY);
	const hasSerper = Boolean(process.env.SERPER_API_KEY);

	const searchFns = [];
	if (hasVertex) searchFns.push(searchVertexGrounded);
	if (hasBrave) searchFns.push(searchBrave);
	if (hasTavily) searchFns.push(searchTavily);
	if (hasExa) searchFns.push(searchExa);
	if (hasSerper) searchFns.push(searchSerper);

	// Run up to 2 sources in parallel for speed.
	const primary = searchFns.slice(0, 2);
	let combined = [];
	let errors = [];

	if (primary.length > 0) {
		const settled = await Promise.allSettled(primary.map((fn) => fn(query)));
		for (const outcome of settled) {
			if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
				combined.push(...outcome.value);
			} else if (outcome.status === 'rejected') {
				errors.push(outcome.reason?.message || String(outcome.reason));
			}
		}
	}

	// If not enough results, try remaining sources sequentially.
	for (const fn of searchFns.slice(2)) {
		if (deduplicate(combined).length >= 3) break;
		try {
			const more = await fn(query);
			if (Array.isArray(more)) combined.push(...more);
		} catch (err) {
			errors.push(err.message);
		}
	}

	// Free, keyless fallback #1: Wikipedia full-text search — tried whenever the
	// configured (or absent) paid providers haven't reached 3 results yet.
	if (deduplicate(combined).length < 3) {
		try {
			const wiki = await searchWikipedia(query, { deadline });
			combined.push(...wiki);
		} catch (err) {
			errors.push(err.message);
		}
	}

	// Free, keyless fallback #2: DuckDuckGo Instant Answer.
	if (deduplicate(combined).length < 3) {
		try {
			const ddg = await searchDuckDuckGo(query);
			combined.push(...ddg);
		} catch (err) {
			errors.push(err.message);
		}
	}

	const deduped = deduplicate(combined);

	if (deduped.length === 0) {
		const detail = errors.length ? errors.join('; ') : 'no search providers configured';
		const err = new Error(`Search returned no results: ${detail}`);
		err.status = 502;
		err.code = 'search_failed';
		throw err;
	}

	if (deduped.length < 3) {
		// Return what we have — the verdict logic will mark it 'insufficient'.
	}

	return deduped;
}

/**
 * Run every query in parallel and interleave the per-query result lists
 * round-robin (query1[0], query2[0], query3[0], query1[1], …) before
 * deduplicating.
 *
 * Order matters downstream: the consumer only stance-checks the first 5
 * results, so a plain concatenation handed all five slots to query 1 and threw
 * away the other two search angles the query generator was asked to produce.
 * Round-robin guarantees each angle is represented in the checked set, which is
 * what makes a contradicting source reachable when the first angle's phrasing
 * only surfaces confirmations.
 *
 * @param {string[]} queries  Up to 3 queries.
 * @param {{budgetMs?: number}} [opts] Wall-clock allowance for the whole sweep.
 *   A query that has not answered by then contributes nothing rather than
 *   holding the caller open. Each rung below has its own per-request timeout,
 *   but a full fallback walk (grounded search → Wikipedia → DuckDuckGo) can
 *   still outlast an edge timeout, and partial evidence beats a request the
 *   edge kills carrying none. Omit for no deadline.
 * @returns {Promise<Array<{url: string, title: string, snippet: string}>>}
 */
export async function searchAll(queries, opts = {}) {
	const budgetMs = Number(opts.budgetMs) || 0;
	const bounded = (promise) => {
		if (budgetMs <= 0) return promise;
		let timer;
		return Promise.race([
			promise.finally(() => clearTimeout(timer)),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve([]), budgetMs);
				timer.unref?.();
			}),
		]);
	};
	// The same budget that bounds a query is handed to the query itself, so a
	// rung can degrade gracefully inside the deadline instead of being cut off at
	// it and losing evidence it had already retrieved.
	const deadline = budgetMs > 0 ? Date.now() + budgetMs : 0;
	const settled = await Promise.allSettled(queries.map((q) => bounded(searchWeb(q, { deadline }))));
	const lists = settled
		.filter((o) => o.status === 'fulfilled' && Array.isArray(o.value))
		.map((o) => o.value);

	const interleaved = [];
	const depth = Math.max(0, ...lists.map((l) => l.length));
	for (let i = 0; i < depth; i++) {
		for (const list of lists) {
			if (i < list.length) interleaved.push(list[i]);
		}
	}
	return deduplicate(interleaved);
}
