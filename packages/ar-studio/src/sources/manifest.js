// A source backed by any JSON catalogue at a URL.
//
// This is the escape hatch that makes the studio yours: host a JSON file
// anywhere with open CORS and point `assets` at it. Five shapes are accepted so
// an existing manifest usually needs no reshaping at all:
//
//   [ { url, name } … ]                       a bare array
//   { items:     [ … ] }                      the canonical wrapper
//   { objects:   [ … ] }                      three.ws object library
//   { avatars:   [ … ] }                      three.ws avatar library
//   { creations: [ … ] }                      three.ws forge gallery
//   { models:    [ … ] }                      common third-party wrapper
//
// Per-item, the model URL is read from the first present of
// `src | url | glb | glb_url | glbUrl | file | model`, the label from
// `title | label | name | prompt`, and the thumbnail from
// `poster | thumb | thumbnail | image | preview_image_url | previewImageUrl`.
// Anything that is not an https (or site-relative) URL is dropped rather than
// handed to the loader.

import { safeUrl } from '../config.js';

/**
 * @param {object} opts
 * @param {string} opts.url            JSON catalogue URL.
 * @param {string} [opts.id]           Tab key. Defaults to a slug of the label.
 * @param {string} [opts.label]        Tab label. Defaults to 'Models'.
 * @param {string} [opts.hint]         Line rendered under the search box.
 * @param {boolean} [opts.searchable]  Show the filter box. Defaults to true when
 *   the catalogue returns more than 24 items.
 * @param {(item: object) => object|null} [opts.map]  Custom per-item mapper. Return
 *   `{ src, title, poster, keywords }` or null to drop the entry.
 * @param {(url: string) => string} [opts.rewriteUrl]  Rewrite each asset URL, e.g. to
 *   route a CDN through a proxy that answers CORS.
 * @param {RequestInit} [opts.fetchOptions]
 */
export function manifestSource({
	url, id, label = 'Models', hint = '', searchable, map, rewriteUrl, fetchOptions,
} = {}) {
	if (!url) throw new Error('ar-studio: manifestSource needs a url');
	return {
		id: id || slug(label) || 'models',
		label,
		hint,
		searchable,
		async list() {
			const res = await fetch(url, fetchOptions);
			if (!res.ok) throw new Error(`catalogue ${res.status}`);
			const data = await res.json();
			return normalizeCatalogue(data, { map, rewriteUrl });
		},
	};
}

/** Pull the item array out of any of the accepted wrapper shapes. */
export function catalogueItems(data) {
	if (Array.isArray(data)) return data;
	for (const key of ['items', 'objects', 'avatars', 'creations', 'models', 'assets', 'results']) {
		if (Array.isArray(data?.[key])) return data[key];
	}
	return [];
}

const SRC_KEYS = ['src', 'url', 'glb', 'glb_url', 'glbUrl', 'file', 'model', 'modelUrl'];
const TITLE_KEYS = ['title', 'label', 'name', 'prompt', 'displayName'];
const POSTER_KEYS = ['poster', 'thumb', 'thumbnail', 'image', 'preview_image_url', 'previewImageUrl', 'preview'];

function pick(obj, keys) {
	for (const k of keys) {
		const v = obj?.[k];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return '';
}

/**
 * Normalize any catalogue payload into tray items. Exported so a host writing a
 * custom source can reuse the same tolerant reader.
 *
 * @param {unknown} data
 * @param {{ map?: Function, rewriteUrl?: Function }} [opts]
 * @returns {Array<{src:string,title:string,poster:string,keywords:string}>}
 */
export function normalizeCatalogue(data, { map, rewriteUrl } = {}) {
	const raw = catalogueItems(data);
	const out = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const item = map ? map(entry) : defaultMap(entry);
		if (!item) continue;
		const src = safeUrl(rewriteUrl ? rewriteUrl(item.src) : item.src);
		if (!src) continue;
		const poster = item.poster ? safeUrl(rewriteUrl ? rewriteUrl(item.poster) : item.poster) : '';
		out.push({
			src,
			title: String(item.title || '').slice(0, 160),
			poster: poster || '',
			keywords: String(item.keywords || item.title || '').trim().toLowerCase(),
		});
	}
	return out;
}

function defaultMap(entry) {
	const src = pick(entry, SRC_KEYS);
	if (!src) return null;
	const title = pick(entry, TITLE_KEYS) || filenameTitle(src);
	const tags = []
		.concat(Array.isArray(entry.categories) ? entry.categories : [])
		.concat(Array.isArray(entry.tags) ? entry.tags : [])
		.join(' ');
	return {
		src,
		title,
		poster: pick(entry, POSTER_KEYS),
		keywords: `${title} ${tags}`.trim().toLowerCase(),
	};
}

/** A readable label from a file name: `alarm_clock_01.glb` → `Alarm clock 01`. */
export function filenameTitle(url) {
	const base = String(url).split('?')[0].split('/').pop() || 'Model';
	const stem = base.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').trim();
	return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : 'Model';
}

function slug(s) {
	return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
