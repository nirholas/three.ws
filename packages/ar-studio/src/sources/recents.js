// The models this browser generated or placed recently, held in localStorage.
//
// It is the tab that makes the studio feel like yours after one use: generate a
// model, close the tab, come back tomorrow, it is still the first thing you see.
// Storage failures (private mode, disabled storage, a quota wall) degrade to an
// empty list, never a thrown error.

import { safeUrl } from '../config.js';

const DEFAULT_KEY = 'ar-studio:recent:v1';
const MAX = 12;

/** Read the recents list for a storage key. Corrupt or hostile payloads read as empty. */
export function readRecents(key = DEFAULT_KEY) {
	try {
		const raw = JSON.parse(localStorage.getItem(key) || '[]');
		if (!Array.isArray(raw)) return [];
		return raw
			.map((e) => ({
				src: safeUrl(e?.src || e?.glb),
				title: String(e?.title || e?.prompt || '').slice(0, 160),
				poster: e?.poster ? safeUrl(e.poster) || '' : '',
				ts: Number(e?.ts) || 0,
			}))
			.filter((e) => e.src);
	} catch {
		return [];
	}
}

/** Push one model to the front of the recents list (de-duplicated by source). */
export function rememberRecent({ src, title = '', poster = '' }, key = DEFAULT_KEY) {
	const url = safeUrl(src);
	if (!url) return;
	try {
		const list = readRecents(key).filter((e) => e.src !== url);
		list.unshift({ src: url, title: String(title).slice(0, 200), poster: poster || '', ts: Date.now() });
		localStorage.setItem(key, JSON.stringify(list.slice(0, MAX)));
	} catch {
		// Storage unavailable: recents are a convenience, never a gate.
	}
}

/**
 * @param {object} [cfg] Studio config: `recentKey` overrides the storage key.
 */
export function recentSource(cfg = {}) {
	const key = cfg.recentKey || DEFAULT_KEY;
	return {
		id: 'recent',
		label: 'Recent',
		hint: '',
		live: true, // re-read on every open: this list changes as you work
		emptyCopy: 'Nothing here yet. Generate a model below, or paste a GLB link, and it lands in this tab.',
		async list() {
			return readRecents(key).map((e) => ({
				src: e.src, title: e.title, poster: e.poster, keywords: e.title.toLowerCase(),
			}));
		},
	};
}
