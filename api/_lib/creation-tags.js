// Canonical tags for 3D creations (work order 819).
//
// Florence-2 tags every creation's poster (workers/model-florence2), owners can
// edit those tags, and search matches a typed word against them. All three go
// through normalizeTag so they meet on one form: lowercase ASCII, at most three
// words, no leading article, never a generic picture word ("background") and
// never a slur from the shared blocklist. The rules mirror
// workers/model-florence2/tags.py on purpose; the worker never returns a tag
// this module would reject, and the API re-normalizes everything it stores.

import { containsHateSlur } from './display-name-safety.js';

export const MAX_TAGS = 12;
export const MAX_TAG_CHARS = 32;
export const MAX_TAG_WORDS = 3;

// Words that describe the picture rather than the thing in it. Kept identical
// to GENERIC_NOUNS in workers/model-florence2/tags.py.
const GENERIC_NOUNS = new Set(
	`image picture photo photograph render rendering illustration drawing view
	background foreground backdrop scene shot close closeup close-up top bottom
	side front back left right middle center centre corner edge surface
	color colour shade shape style design detail details object objects item
	thing things part parts piece pieces model models 3d figure figurine
	texture pattern appearance look lighting light shadow shadows reflection
	white black grey gray area space frame angle perspective position
	the this that these those some`.split(/\s+/),
);

const ARTICLES = /^(a|an|the|this|that|these|those|some)\s+/;

/**
 * One canonical tag, or '' when the input cannot be a tag.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTag(raw) {
	if (typeof raw !== 'string') return '';
	let text = raw
		.normalize('NFKD')
		.replace(/[^\x00-\x7f]/g, '')
		.toLowerCase()
		.replace(/_/g, ' ')
		.replace(/[^a-z0-9 -]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[ -]+|[ -]+$/g, '')
		.replace(ARTICLES, '');
	if (!text) return '';
	const words = text
		.split(' ')
		.map((w) => w.replace(/^-+|-+$/g, ''))
		.filter(Boolean);
	if (!words.length || words.length > MAX_TAG_WORDS) return '';
	const tag = words.join(' ');
	if (tag.length > MAX_TAG_CHARS || tag.length < 2) return '';
	if (/^[0-9 -]+$/.test(tag)) return '';
	if (GENERIC_NOUNS.has(tag)) return '';
	if (containsHateSlur(tag)) return '';
	return tag;
}

function singularOf(tag) {
	return tag.endsWith('s') && !tag.endsWith('ss') ? tag.slice(0, -1) : tag;
}

/**
 * Normalize a list, drop empties and duplicates (a plural whose singular is
 * already present counts as a duplicate), keep the first spelling, cap it.
 * @param {unknown} tags
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function normalizeTags(tags, { limit = MAX_TAGS } = {}) {
	if (!Array.isArray(tags)) return [];
	const out = [];
	const seen = new Set();
	for (const raw of tags) {
		const tag = normalizeTag(raw);
		if (!tag) continue;
		const singular = singularOf(tag);
		if (seen.has(tag) || seen.has(singular)) continue;
		seen.add(tag);
		seen.add(singular);
		out.push(tag);
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * The tag forms a search query should match: the canonical tag plus its
 * singular or plural, so "lanterns" finds a creation tagged "lantern".
 * Empty when the query is not a valid tag (search then matches text only).
 * @param {unknown} q
 * @returns {string[]}
 */
export function tagQueryVariants(q) {
	const tag = normalizeTag(q);
	if (!tag) return [];
	const singular = singularOf(tag);
	const other = singular === tag ? (tag.endsWith('ss') ? `${tag}es` : `${tag}s`) : singular;
	return other === tag ? [tag] : [tag, other];
}
