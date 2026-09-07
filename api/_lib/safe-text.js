// Truncation that never splits a character.
//
// A JavaScript string is UTF-16 code units, so `s.slice(0, 240)` can land in
// the middle of a surrogate pair and leave a lone high surrogate behind. That
// half-character survives every downstream step: JSON.stringify escapes it as
// "\ud83d" (well-formed stringify, ES2019), UTF-8 encoding turns it into a
// replacement glyph, and Google Search Console rejects the page's structured
// data outright with "Unparsable structured data: truncated Unicode character".
// An archived story page whose description opens with an emoji lost its rich
// results exactly that way on 2026-09-06.
//
// Grapheme clusters, not just code points: cutting between the two code points
// of a flag, a skin-tone modifier, or a ZWJ family emoji produces a different
// visible character rather than the one the publisher wrote. Intl.Segmenter is
// in the Node and browser platform, so this needs no dependency.

const HIGH_START = 0xd800;
const HIGH_END = 0xdbff;
const LOW_START = 0xdc00;
const LOW_END = 0xdfff;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Segmenting a whole 8000-char body to keep its first 240 chars is wasted work.
// Boundaries at or below `max` are decided by nearby context, so a probe a few
// clusters longer than the budget yields the same answer as the full string.
const PROBE_SLACK = 64;

/**
 * Longest prefix of `text` that fits `max` UTF-16 code units and ends on a
 * grapheme boundary.
 *
 * The result is always well-formed Unicode, including when the INPUT already
 * carried a half character from an upstream feed. That guarantee is not
 * decorative: encodeURIComponent() throws `URIError: URI malformed` on a lone
 * surrogate, so one poisoned feed item would turn a story page into a 500
 * rather than a page with an odd glyph.
 *
 * @param {unknown} text
 * @param {number} max budget in UTF-16 code units (what `.length` counts)
 * @returns {string}
 */
export function truncateChars(text, max) {
	const s = String(text ?? '');
	if (!(max > 0)) return '';
	if (s.length <= max) return hasLoneSurrogate(s) ? stripLoneSurrogates(s) : s;

	let out = '';
	for (const { segment } of segmenter.segment(s.slice(0, max + PROBE_SLACK))) {
		if (out.length + segment.length > max) break;
		out += segment;
	}
	// A cluster can be a lone surrogate the caller handed us; the cut never
	// creates one.
	return hasLoneSurrogate(out) ? stripLoneSurrogates(out) : out;
}

/**
 * Drop unpaired surrogates. The last line of defence at a serialization
 * boundary: upstream feeds and already-stored records can carry a half
 * character we did not create, and one of those poisons a whole JSON-LD block.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function stripLoneSurrogates(text) {
	const s = String(text ?? '');
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code >= HIGH_START && code <= HIGH_END) {
			const next = s.charCodeAt(i + 1);
			if (next >= LOW_START && next <= LOW_END) {
				out += s[i] + s[i + 1];
				i++;
			}
			continue;
		}
		if (code >= LOW_START && code <= LOW_END) continue;
		out += s[i];
	}
	return out;
}

/** True when `text` holds a surrogate with no partner. Used by tests and audits. */
export function hasLoneSurrogate(text) {
	const s = String(text ?? '');
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code >= HIGH_START && code <= HIGH_END) {
			const next = s.charCodeAt(i + 1);
			if (!(next >= LOW_START && next <= LOW_END)) return true;
			i++;
		} else if (code >= LOW_START && code <= LOW_END) {
			return true;
		}
	}
	return false;
}

/**
 * JSON for embedding in a `<script>` block: well-formed Unicode, and `<`
 * escaped so the payload cannot close its own tag.
 *
 * @param {unknown} value
 * @param {number|string} [space] indent, as JSON.stringify takes it
 * @returns {string}
 */
export function scriptJson(value, space) {
	return JSON.stringify(value, (_k, v) => (typeof v === 'string' ? stripLoneSurrogates(v) : v), space).replace(
		/</g,
		'\\u003c',
	);
}
