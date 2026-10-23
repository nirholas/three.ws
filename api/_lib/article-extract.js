// Full-text article extraction — the ladder behind the /markets/news reader.
// ---------------------------------------------------------------------------
// Many crypto publishers (The Defiant, CoinDesk, The Block, …) sit behind
// Cloudflare and answer a plain server-side fetch with a 403, so the reader
// used to fall straight through to the RSS teaser — a single truncated
// sentence ending "Read the full story at …". That reads as an empty page.
//
// This module gives the extractor a real ladder:
//   1. page    — fetch the publisher HTML directly and pull its <article> prose
//   2. reader  — when the page is blocked or JS-rendered, re-fetch it through
//                Jina Reader (r.jina.ai), a free, keyless reader service that
//                renders the page and returns clean markdown. This recovers the
//                full body for the Cloudflare-blocked publishers.
//   3. wayback, the Internet Archive's snapshot of the same URL (paywalled or
//                since-removed stories keep their full body there)
//   4. primary, the SEC EDGAR filing of the company the headline names
//   5. siblings, other outlets' coverage of the same story (feed descriptions)
//   6. feed   , the publisher's own RSS content:encoded body (full for the
//                WordPress-style feeds, a teaser for the rest)
//   7. preview, honest metadata-only preview with a read-at-source CTA
//
// Rungs 3-5 live in ./article-lanes.js.
//
// Every rung is SSRF-guarded by the shared platform guard (./ssrf-guard.js):
// all DNS answers are validated (not just the first), the connection is pinned
// to the validated IP, and every redirect hop is re-validated before it is
// followed. The reader rung additionally validates the target before handing
// it to the reader service (which would otherwise proxy it).

import { assertSafePublicUrl, fetchSafePublicUrlPinned } from './ssrf-guard.js';
import { stripHtml } from './news.js';
import { fetchViaWayback, fetchPrimaryFiling, fetchSiblings } from './article-lanes.js';

const FETCH_TIMEOUT_MS = 10_000;
const READER_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// Realistic desktop UA — some publishers 403 obvious bots but serve a browser
// UA. The reader rung covers the ones that still block (JS challenges).
const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── Rung 1: direct HTML ────────────────────────────────────────────────────

export async function fetchArticleHtml(url) {
	// Pinned fetch: DNS is fully validated, the socket connects only to the
	// checked address, and redirect hops are re-validated, so a publisher (or
	// a hostile link submitted to /api/news/article?url=) cannot 302 us into
	// the metadata service or an internal address. maxBytes caps the stream.
	const resp = await fetchSafePublicUrlPinned(
		url,
		{
			headers: {
				'user-agent': BROWSER_UA,
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.9',
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		},
		{ maxBytes: MAX_RESPONSE_BYTES },
	);
	if (!resp.ok) throw Object.assign(new Error(`source responded ${resp.status}`), { status: resp.status });
	const contentType = resp.headers.get('content-type') || '';
	if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
		throw new Error(`unsupported content type: ${contentType.split(';')[0] || 'unknown'}`);
	}
	return resp.text();
}

export function extractParagraphs(html) {
	// Prefer semantic containers; fall back to the whole document.
	const scoped =
		html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
		html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
		html;
	const cleaned = scoped
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<(nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, ' ');
	const paragraphs = [];
	for (const m of cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
		const text = stripHtml(m[1]);
		// skip boilerplate fragments (share prompts, cookie banners, bylines-only)
		if (text.length < 40) continue;
		paragraphs.push(text);
		if (paragraphs.length >= 60) break;
	}
	// Some sites (notably CMS-rendered Chinese outlets) use <div> text blocks.
	if (!paragraphs.length) {
		const text = stripHtml(cleaned);
		if (text.length > 200) {
			for (let i = 0; i < text.length && paragraphs.length < 20; i += 400) {
				paragraphs.push(text.slice(i, i + 400));
			}
		}
	}
	return paragraphs;
}

// ── Rung 2: reader service (Jina) ──────────────────────────────────────────

// Boilerplate a reader render still leaves in the markdown — nav labels, share
// prompts, subscribe CTAs, cookie notices. Matched case-insensitively against
// the whole line.
const READER_NOISE = /^(share|tweet|copy link|subscribe|sign up|sign in|log in|newsletter|advertisement|related|read more|read next|follow us|cookie|we use cookies|©|all rights reserved|disclaimer|table of contents|menu|toggle|skip to|home\b|search\b|back to)/i;

// Nav/UI chrome a reader render leaves inline reads like a run of short labels
// with no sentence punctuation ("Toggle navigation menu Toggle theme", "Markets
// Prices Research Events"). A real article paragraph almost always ends a
// sentence — so require sentence punctuation unless the block is long-form.
function looksLikeProse(block) {
	if (!/[.!?。]/.test(block)) return false; // no sentence terminator → nav/label chrome
	// Run-together nav menus ("DeFiCeFiTradFi & FintechBlockchains…") have almost
	// no spaces relative to their length.
	const spaces = (block.match(/\s/g) || []).length;
	if (spaces / block.length < 0.08) return false;
	// A run of Title-Case single words is a nav bar, not a sentence.
	const words = block.split(/\s+/);
	const titleWords = words.filter((w) => /^[A-Z][a-z’']+$/.test(w)).length;
	if (words.length >= 5 && titleWords / words.length > 0.7) return false;
	return true;
}

/**
 * Parse Jina Reader markdown into clean article paragraphs. Jina emits:
 *   Title: …
 *   URL Source: …
 *   Markdown Content:
 *   <the body, links as [text](url), images as ![alt](url), blank-line paras>
 */
export function paragraphsFromReaderMarkdown(md) {
	let body = md;
	const marker = md.indexOf('Markdown Content:');
	if (marker !== -1) body = md.slice(marker + 'Markdown Content:'.length);
	const out = [];
	// Paragraphs are blank-line separated; a single \n inside a block is a soft
	// wrap we join back together.
	for (const rawBlock of body.split(/\n{2,}/)) {
		let block = rawBlock
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
			.replace(/^#{1,6}\s+/gm, '') // headings → text
			.replace(/^>\s?/gm, '') // blockquote markers
			.replace(/[*_`]{1,3}/g, '') // emphasis / code marks
			.replace(/\s*\n\s*/g, ' ') // soft-wrap → space
			.trim();
		if (block.length < 45) continue; // teaser fragments, captions, nav labels
		if (READER_NOISE.test(block)) continue;
		if (/^[-*•|]/.test(block)) continue; // list / table chrome
		if ((block.match(/https?:\/\//g) || []).length > 2) continue; // link farms
		if (!looksLikeProse(block)) continue; // nav bars, label runs
		out.push(block.slice(0, 2000));
		if (out.length >= 60) break;
	}
	return out;
}

export async function fetchViaReader(url) {
	// Validate the target ourselves before handing it to the reader service:
	// r.jina.ai would otherwise fetch (and proxy back) anything, including
	// addresses we are forbidden to touch.
	await assertSafePublicUrl(url);
	// r.jina.ai renders the page and returns readable markdown. Keyless and
	// free; a token unlocks higher limits but is not required.
	const resp = await fetchSafePublicUrlPinned(
		`https://r.jina.ai/${url}`,
		{
			headers: {
				accept: 'text/plain',
				'x-return-format': 'markdown',
				'user-agent': BROWSER_UA,
			},
			signal: AbortSignal.timeout(READER_TIMEOUT_MS),
		},
		{ maxBytes: MAX_RESPONSE_BYTES },
	);
	if (!resp.ok) throw Object.assign(new Error(`reader responded ${resp.status}`), { status: resp.status });
	const md = await resp.text();
	return paragraphsFromReaderMarkdown(md);
}

// ── Rung 6: publisher feed body ────────────────────────────────────────────

export function paragraphsFromFeed(contentText) {
	return String(contentText || '')
		.split(/(?<=[.!?。])\s+(?=[A-Z0-9"“【「])|\n+/)
		.reduce((acc, sentence) => {
			const last = acc[acc.length - 1];
			if (last && last.length + sentence.length < 420) acc[acc.length - 1] = `${last} ${sentence}`;
			else acc.push(sentence);
			return acc;
		}, [])
		.filter((p) => p.trim().length > 20);
}

// A feed body that is just the publisher's teaser + a "read the full story"
// stub is NOT the full article — treat it as thin so the reader rung runs.
function feedBodyIsTeaser(paragraphs) {
	if (paragraphs.length >= 3) return false;
	const joined = paragraphs.join(' ');
	return joined.length < 600 || /read (the )?(full|more|rest)|continue reading|\[…\]|\.\.\.$/i.test(joined);
}

/**
 * Run the full extraction ladder for one article URL.
 *
 * @param {string} url             the (already-validated-as-absolute) target
 * @param {object} [opts]
 * @param {string} [opts.feedContentText]  publisher feed body, if any
 * @param {string} [opts.title]            headline, used to find primary documents and sibling coverage
 * @param {string} [opts.publishedAt]      publish time, to window the EDGAR search
 * @returns {Promise<{ paragraphs: string[], extraction: 'page'|'reader'|'wayback'|'primary'|'siblings'|'feed'|'preview', blocked_reason: string|null, html: string|null, lane_sources: Array<{label: string, url: string}> }>}
 */
export async function extractArticle(url, { feedContentText = null, title = null, publishedAt = null } = {}) {
	let html = null;
	let fetchError = null;
	try {
		html = await fetchArticleHtml(url);
	} catch (err) {
		fetchError = err;
	}

	// Rung 1 — direct page prose.
	let paragraphs = html ? extractParagraphs(html) : [];
	if (paragraphs.length >= 3) {
		return { paragraphs, extraction: 'page', blocked_reason: null, html, lane_sources: [] };
	}

	// Rung 2 — reader service. Runs when the page was blocked or yielded almost
	// nothing (paywall interstitial, JS-only shell). Never lose a good page
	// result: only replace it if the reader returns strictly more prose.
	let readerError = null;
	try {
		const readerParas = await fetchViaReader(url);
		if (readerParas.length > paragraphs.length && readerParas.length >= 2) {
			return { paragraphs: readerParas, extraction: 'reader', blocked_reason: null, html, lane_sources: [] };
		}
	} catch (err) {
		readerError = err;
	}

	// Rung 3: Wayback. The same article as it was archived: strictly better than
	// a partial page, so it runs for any page thinner than a full read.
	let laneError = null;
	try {
		const { paragraphs: archived, snapshot, html: archivedHtml } = await fetchViaWayback(url, extractParagraphs);
		if (archived.length >= 3 && archived.length > paragraphs.length) {
			return {
				paragraphs: archived,
				extraction: 'wayback',
				blocked_reason: null,
				// The snapshot's own metadata (headline, image, byline) stands in
				// when the live page was blocked.
				html: html || archivedHtml,
				lane_sources: [{ label: 'Internet Archive snapshot', url: snapshot }],
			};
		}
	} catch (err) {
		laneError = err;
	}

	// A partial direct page (2 paragraphs) still beats the substitutes below.
	if (paragraphs.length >= 2) {
		return { paragraphs, extraction: 'page', blocked_reason: null, html, lane_sources: [] };
	}

	// Rung 4: primary document: the SEC filing the headline's company made.
	if (title) {
		try {
			const { paragraphs: filed, filing } = await fetchPrimaryFiling(title, publishedAt, extractParagraphs);
			if (filed.length >= 2) {
				return {
					paragraphs: filed,
					extraction: 'primary',
					blocked_reason: null,
					html,
					lane_sources: [{ label: `${filing.filer} ${filing.form} filed ${filing.filed}`, url: filing.url }],
				};
			}
		} catch (err) {
			laneError = laneError || err;
		}

		// Rung 5: sibling coverage from other outlets.
		try {
			const { paragraphs: sibling, siblings } = await fetchSiblings(title, url);
			if (siblings.length >= 2) {
				return {
					paragraphs: sibling,
					extraction: 'siblings',
					blocked_reason: null,
					html,
					lane_sources: siblings.map((s) => ({ label: s.source, url: s.link })),
				};
			}
		} catch (err) {
			laneError = laneError || err;
		}
	}

	// Rung 6, publisher feed body, when it is more than a teaser.
	if (feedContentText) {
		const feedParas = paragraphsFromFeed(feedContentText);
		if (feedParas.length && !feedBodyIsTeaser(feedParas)) {
			return { paragraphs: feedParas, extraction: 'feed', blocked_reason: null, html, lane_sources: [] };
		}
		// Even a teaser is better than nothing when both live rungs failed.
		if (feedParas.length && !html && readerError) {
			return { paragraphs: feedParas, extraction: 'feed', blocked_reason: null, html, lane_sources: [] };
		}
	}

	// Rung 7, honest preview.
	const reason = fetchError
		? String(fetchError.message || 'fetch failed')
		: readerError
			? String(readerError.message || 'reader failed')
			: laneError
				? String(laneError.message || 'archive lookup failed')
				: 'no extractable article body';
	return { paragraphs, extraction: 'preview', blocked_reason: reason, html, lane_sources: [] };
}
