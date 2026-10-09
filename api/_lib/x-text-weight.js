// X's weighted post length, implemented from X's documented counting rules
// (the v3 text-parsing configuration): a post holds 280 weighted characters,
// where Latin text and common punctuation weigh 1, every other code point
// (CJK, Hangul, Cyrillic extensions, most symbols) weighs 2, an emoji
// sequence weighs 2, and any URL weighs 23 whatever its real length.
//
// Why not the `twitter-text` package: its last release (3.1.0) is from June
// 2022, which fails the repo's open-source rule (nothing unmaintained for 2+
// years), and it ships a large bundle of legacy parsing we do not use. This
// module is the counting subset, covered by tests/x-text-weight.test.js.

export const X_POST_MAX_WEIGHT = 280;
export const X_URL_WEIGHT = 23;

// Code point ranges that weigh 1. Everything else weighs 2.
const LIGHT_RANGES = [
	[0, 4351],
	[8192, 8205],
	[8208, 8223],
	[8242, 8247],
];

const URL_RE = /https?:\/\/[^\s<>"'`]+/giu;
const EMOJI_MOD = '[\\u{1F3FB}-\\u{1F3FF}]';
const EMOJI_ONE = `\\p{Extended_Pictographic}(?:\\uFE0F|${EMOJI_MOD})*`;
const EMOJI_SEQ_RE = new RegExp(`${EMOJI_ONE}(?:\\u200D${EMOJI_ONE})*|\\p{Regional_Indicator}{2}`, 'gu');
// Trailing punctuation that belongs to the sentence, not to the URL.
const URL_TRAIL_RE = /[.,;:!?)\]}'"]+$/u;

function codePointWeight(cp) {
	for (const [lo, hi] of LIGHT_RANGES) if (cp >= lo && cp <= hi) return 1;
	return 2;
}

function plainWeight(s) {
	let w = 0;
	for (const ch of s) w += codePointWeight(ch.codePointAt(0));
	return w;
}

function segmentWeight(s) {
	let w = 0;
	let last = 0;
	for (const m of s.matchAll(EMOJI_SEQ_RE)) {
		w += plainWeight(s.slice(last, m.index)) + 2;
		last = m.index + m[0].length;
	}
	return w + plainWeight(s.slice(last));
}

/** URL spans in `text` as { start, end } offsets, with sentence punctuation trimmed off. */
export function findUrls(text) {
	const out = [];
	for (const m of String(text).matchAll(URL_RE)) {
		const trail = URL_TRAIL_RE.exec(m[0]);
		out.push({ start: m.index, end: m.index + m[0].length - (trail ? trail[0].length : 0) });
	}
	return out;
}

/** The weighted length of `text` as X counts it. */
export function weightedLength(text) {
	const s = String(text ?? '').normalize('NFC');
	let w = 0;
	let last = 0;
	for (const u of findUrls(s)) {
		w += segmentWeight(s.slice(last, u.start)) + X_URL_WEIGHT;
		last = u.end;
	}
	return w + segmentWeight(s.slice(last));
}

export function fitsInPost(text, max = X_POST_MAX_WEIGHT) {
	return weightedLength(text) <= max;
}

/**
 * Longest prefix of `text` (cut on a code point, never inside a URL or an
 * emoji sequence) whose weighted length is at most `max`. Returns the
 * character offset.
 */
function prefixWithin(text, max) {
	const urls = findUrls(text);
	const emoji = [...text.matchAll(EMOJI_SEQ_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
	const atoms = [...urls.map((u) => ({ ...u, weight: X_URL_WEIGHT })), ...emoji.map((e) => ({ ...e, weight: 2 }))].sort((a, b) => a.start - b.start);
	let w = 0;
	let i = 0;
	let ai = 0;
	while (i < text.length) {
		while (ai < atoms.length && atoms[ai].end <= i) ai++;
		const atom = atoms[ai] && atoms[ai].start === i ? atoms[ai] : null;
		const step = atom ? atom.end - i : String.fromCodePoint(text.codePointAt(i)).length;
		const add = atom ? atom.weight : codePointWeight(text.codePointAt(i));
		if (w + add > max) break;
		w += add;
		i += step;
	}
	return i;
}

function cutPoint(text, max) {
	const hard = prefixWithin(text, max);
	if (hard >= text.length) return text.length;
	const floor = hard * 0.5;
	for (const sep of ['\n\n', '\n', '. ', ' ']) {
		const at = text.lastIndexOf(sep, hard);
		if (at >= floor && at > 0) return at + (sep === '. ' ? 1 : 0);
	}
	return hard;
}

/**
 * Split `text` into at most `maxParts` posts of at most `max` weighted
 * characters each, preferring paragraph, line, sentence then word boundaries.
 * Text that does not fit even then ends the last part with "..." so a reply
 * never exceeds the chain and never ends mid-URL.
 */
export function chunkForX(text, { max = X_POST_MAX_WEIGHT, maxParts = 2 } = {}) {
	let rest = String(text ?? '').normalize('NFC').trim();
	const parts = [];
	while (rest && parts.length < maxParts) {
		if (weightedLength(rest) <= max) {
			parts.push(rest);
			rest = '';
			break;
		}
		if (parts.length === maxParts - 1) {
			const room = max - 3;
			const cut = cutPoint(rest, room);
			parts.push(`${rest.slice(0, cut).trimEnd()}...`);
			rest = '';
			break;
		}
		const cut = cutPoint(rest, max);
		parts.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	return parts.filter(Boolean);
}
