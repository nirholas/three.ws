// @ts-check
// X's documented "weighted length" counting (config v3: scale 100, default
// weight 200, a set of ranges weighted 100), the same rule x.com's own
// composer and every first-party client enforce. A post is valid when its
// weighted length is at most 280.
//
// We do not depend on the `twitter-text` npm package for this: its last
// publish was 2022-06-28 (verified against the npm registry on 2026-10-11,
// over four years stale against CLAUDE.md's open-source-first bar), it pulls
// core-js, @babel/runtime and twemoji-parser for a counting function, and the
// weighting rule itself is a short, stable, publicly documented table. A
// faithful reimplementation is smaller and has no transitive dependencies to
// go stale under us.
//
// PURE. No network, no clock.

export const MAX_WEIGHTED_LENGTH = 280;
export const TRANSFORMED_URL_LENGTH = 23;

const SCALE = 100;
const DEFAULT_WEIGHT = 200;
// Codepoints in these ranges weigh 100 (1 weighted char): Basic Latin through
// Arabic Extended-A. Everything else, including CJK ideographs and emoji,
// falls through to DEFAULT_WEIGHT (2 weighted chars).
const RANGES = [
	{ start: 0, end: 4351, weight: 100 },
	{ start: 8192, end: 8205, weight: 100 },
	{ start: 8208, end: 8223, weight: 100 },
	{ start: 8242, end: 8247, weight: 100 },
];

const URL_RE = /https?:\/\/[^\s<>()[\]{}"']+/gi;

function weightFor(codePoint) {
	for (const r of RANGES) if (codePoint >= r.start && codePoint <= r.end) return r.weight;
	return DEFAULT_WEIGHT;
}

/** Non-overlapping, ordered spans of every http(s) URL in `str`. PURE. */
function urlSpans(str) {
	const spans = [];
	URL_RE.lastIndex = 0;
	let m;
	while ((m = URL_RE.exec(str))) spans.push({ start: m.index, end: m.index + m[0].length });
	return spans;
}

/**
 * X's weighted length of `text`: most scripts count 1 per character, CJK and
 * other wide scripts count 2, and any http(s) URL counts as exactly
 * TRANSFORMED_URL_LENGTH regardless of its real length (X rewrites it to a
 * t.co link of that length). PURE.
 * @param {string} text
 */
export function weightedLength(text) {
	const str = String(text ?? '');
	const spans = urlSpans(str);
	let total = 0;
	let pos = 0;
	let spanIdx = 0;
	while (pos < str.length) {
		const span = spans[spanIdx];
		if (span && pos === span.start) {
			total += TRANSFORMED_URL_LENGTH * SCALE;
			pos = span.end;
			spanIdx += 1;
			continue;
		}
		const cp = str.codePointAt(pos);
		total += weightFor(cp);
		pos += cp > 0xffff ? 2 : 1;
	}
	return Math.ceil(total / SCALE);
}

/** Whether `text` fits in one post of X's documented 280-weighted-character cap. */
export function fitsInTweet(text, max = MAX_WEIGHTED_LENGTH) {
	return weightedLength(text) <= max;
}

/**
 * The longest prefix of `str` whose weighted length is at most `maxWeight`,
 * preferring to break on whitespace near that boundary so words are not cut
 * mid-way. PURE.
 */
export function sliceToWeight(str, maxWeight) {
	if (maxWeight <= 0) return '';
	if (weightedLength(str) <= maxWeight) return str;
	let lo = 0;
	let hi = str.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (weightedLength(str.slice(0, mid)) <= maxWeight) lo = mid;
		else hi = mid - 1;
	}
	let cut = lo;
	// Never split a UTF-16 surrogate pair.
	if (cut > 0 && cut < str.length) {
		const code = str.charCodeAt(cut - 1);
		if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
	}
	const searchFrom = Math.max(0, cut - 40);
	const lastSpace = str.lastIndexOf(' ', cut);
	if (lastSpace > searchFrom) cut = lastSpace;
	return str.slice(0, cut).trimEnd();
}

const ELLIPSIS = '...';

/**
 * Split `text` into at most two posts, each within `limit` weighted
 * characters. A reply that still overflows after two parts is truncated with
 * an ellipsis on the second part rather than growing a longer chain: a
 * mention reply is a short answer, not a thread. PURE.
 * @param {string} text
 * @param {number} [limit]
 * @returns {string[]} 0, 1 or 2 non-empty posts
 */
export function chunkForX(text, limit = MAX_WEIGHTED_LENGTH) {
	const str = String(text ?? '').trim();
	if (!str) return [];
	if (fitsInTweet(str, limit)) return [str];

	const first = sliceToWeight(str, limit);
	const rest = str.slice(first.length).trim();
	if (!rest) return [first];
	if (fitsInTweet(rest, limit)) return [first, rest];

	const second = sliceToWeight(rest, Math.max(0, limit - weightedLength(ELLIPSIS)));
	return [first, `${second.trimEnd()}${ELLIPSIS}`];
}
