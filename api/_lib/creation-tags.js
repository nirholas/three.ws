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
	the this that these those some line lines opening
	one two three four five six seven eight nine ten dozen`.split(/\s+/),
);

// Bare colours describe part of the picture, not what it is ("red car" stays,
// "red" alone does not). Identical to COLOUR_WORDS in tags.py.
const COLOUR_WORDS = new Set(
	`red orange yellow green blue purple violet pink brown gold golden silver
	beige cyan magenta teal turquoise navy maroon tan cream ivory bronze copper
	indigo lavender`.split(/\s+/),
);

// Body parts Florence-2 names on nearly every character poster; a prominent
// part still comes through as a detection label ("human hand").
const BODY_PARTS = new Set([
	...`eye eyes hair hand hands arm arms head face nose mouth ear ears leg legs foot
	feet finger fingers thumb waist shoulder shoulders neck skin nail nails chest
	body lip lips eyebrow eyebrows tooth teeth knee knees elbow wrist`.split(/\s+/),
	...['face', 'head', 'body', 'nose', 'eye', 'mouth', 'ear', 'leg', 'arm', 'hair'].map((p) => `human ${p}`),
]);

// A phrase headed (last word) by one of these describes the picture:
// "violet color", "3d rendering", "silver top", "gray background".
const GENERIC_HEADS = new Set(
	`image picture photo photograph render rendering illustration drawing view
	background foreground backdrop scene shot color colour shade shape style
	design detail details object objects item thing things part parts piece
	pieces texture pattern appearance look lighting shadow reflection area space
	frame angle perspective position top bottom side front back surface`.split(/\s+/),
);

// Text burned into a poster (a generator's watermark) is never a tag.
const TEXT_WORDS = new Set('watermark logo ai text caption signature copyright'.split(' '));

// Plural-only nouns the lemmatizer cuts ("sunglasses" -> "sunglass"); the last
// word is put back. Identical to PLURAL_ONLY in tags.py.
const PLURAL_ONLY = new Map(
	Object.entries({
		sunglass: 'sunglasses',
		eyeglass: 'eyeglasses',
		glasse: 'glasses',
		goggle: 'goggles',
		trouser: 'trousers',
		jean: 'jeans',
		pant: 'pants',
		scissor: 'scissors',
		plier: 'pliers',
		binocular: 'binoculars',
		headphone: 'headphones',
		earphone: 'earphones',
		leave: 'leaf',
	}),
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
	words[words.length - 1] = PLURAL_ONLY.get(words[words.length - 1]) || words[words.length - 1];
	if (words.length > 1 && GENERIC_HEADS.has(words[words.length - 1])) return '';
	if (words.some((w) => TEXT_WORDS.has(w))) return '';
	const tag = words.join(' ');
	if (tag.length > MAX_TAG_CHARS || tag.length < 2) return '';
	if (/^[0-9 -]+$/.test(tag)) return '';
	if (GENERIC_NOUNS.has(tag) || COLOUR_WORDS.has(tag) || BODY_PARTS.has(tag)) return '';
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
