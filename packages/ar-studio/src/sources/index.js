// Asset sources: where the "Add" tray gets its models.
//
// A source is a plain object. Nothing here is a class you must extend:
//
//   {
//     id:    'objects',                    // stable key, used for the tab
//     label: 'Objects',                    // tab label
//     hint:  'Free CC0 props…',            // optional line under the search box
//     searchable: true,                    // render a client-side filter box
//     async list()  -> [{ src, title, poster?, keywords? }]
//   }
//
// `list()` is called once per tab and cached; return everything you have and the
// tray handles slicing + filtering. Throwing from `list()` is fine: the tray
// renders a designed error state with a Retry button.
//
// The `assets` config accepts, in order of convenience:
//   'three.ws'                  the built-in default set (CC0 objects + recents + link)
//   'https://…/manifest.json'   any JSON catalogue (see manifestSource for shapes)
//   { … }                       one source object
//   [ 'recent', {…}, 'https://…' ]  a mixed list, rendered as tabs in order

import { manifestSource } from './manifest.js';
import { staticSource } from './static.js';
import { recentSource } from './recents.js';
import { threeWsObjectsSource, threeWsCommunitySource } from './three-ws.js';

export { manifestSource, staticSource, recentSource, threeWsObjectsSource, threeWsCommunitySource };

/** The tray's paste-a-link tab. Rendered specially (a form, not a list). */
export const LINK_SOURCE = { id: 'link', label: 'Link', kind: 'link' };

/**
 * Turn whatever the host passed as `assets` into an ordered list of sources.
 *
 * @param {string|object|Array} assets
 * @param {object} cfg  Resolved studio config (for the recents key and origin).
 * @returns {Array<object>}
 */
export function resolveSources(assets, cfg = {}) {
	const list = Array.isArray(assets) ? assets : [assets];
	const out = [];
	for (const entry of list) {
		const resolved = resolveOne(entry, cfg);
		if (Array.isArray(resolved)) out.push(...resolved);
		else if (resolved) out.push(resolved);
	}
	// Always end with the paste-a-link tab unless the host supplied one already.
	if (!out.some((s) => s.kind === 'link' || s.id === 'link')) out.push(LINK_SOURCE);
	// De-duplicate by id, first wins, so a host adding 'recent' explicitly in
	// front of the default set doesn't get two Recent tabs.
	const seen = new Set();
	return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

function resolveOne(entry, cfg) {
	if (!entry) return null;
	if (typeof entry === 'object') return entry;
	const key = String(entry).trim();

	if (key === 'three.ws' || key === 'default') {
		return [recentSource(cfg), threeWsObjectsSource(cfg)];
	}
	if (key === 'recent' || key === 'recents') return recentSource(cfg);
	if (key === 'objects') return threeWsObjectsSource(cfg);
	if (key === 'community') return threeWsCommunitySource(cfg);
	if (key === 'link') return LINK_SOURCE;
	if (key === 'none' || key === 'empty') return null;
	if (/^https:\/\//i.test(key) || key.startsWith('/')) return manifestSource({ url: key });
	throw new Error(`ar-studio: unknown asset source "${key}"`);
}
