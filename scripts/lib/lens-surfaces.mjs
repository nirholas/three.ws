// Pages that render on a smart-glasses display rather than a phone or desktop.
// /glass runs in the Meta Ray-Ban Display's on-lens browser: a 600x600 additive
// panel driven by five Neural Band inputs (the arrow keys, Enter and Escape).
//
// These pages carry a hard JavaScript budget and none of the site chrome built
// for a keyboard, mouse or the iOS app: the Atlas palette (bound to "/" and
// Cmd+K), the iOS native bridge (document click capture, share polyfill) and
// the easter eggs (an arrow-key listener on the same keys as the d-pad). The
// injectors in vite.config.js and scripts/inject-atlas.mjs read this set, and
// scripts/check-dist.mjs holds every built lens page to the budget.

import { basename } from 'node:path';

export const LENS_ENTRIES = new Set(['glass.html']);

// Gzipped bytes of JavaScript a lens page may load on first paint.
export const LENS_JS_BUDGET_BYTES = 60 * 1024;

export function isLensEntry(filename) {
	return LENS_ENTRIES.has(basename(filename));
}

const SCRIPT_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const PRELOAD_HREF = /<link\b(?=[^>]*\brel=["']modulepreload["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
// Static imports only: `import"./a.js"` and `from"./a.js"`. A dynamic import()
// loads on demand, after first paint, so it is not part of the budget.
const STATIC_IMPORT = /(?:\bimport|\bfrom)\s*["'](\.{1,2}\/[^"']+\.js)["']/g;

/**
 * Every same-origin script a built page loads on first paint: its <script src>
 * tags, its modulepreload links, and the static imports of those modules,
 * followed transitively. `read(urlPath)` returns a file's text or null.
 * Returns the URL paths in load order, each once.
 */
export function firstPaintScripts(html, read) {
	const seen = new Set();
	const queue = [];
	const add = (url) => {
		if (!url.startsWith('/') || url.startsWith('//') || seen.has(url)) return;
		seen.add(url);
		queue.push(url);
	};
	for (const m of html.matchAll(SCRIPT_SRC)) add(m[1].split(/[?#]/)[0]);
	for (const m of html.matchAll(PRELOAD_HREF)) add(m[1].split(/[?#]/)[0]);
	for (let i = 0; i < queue.length; i++) {
		const code = read(queue[i]);
		if (code == null) continue;
		const base = new URL(queue[i], 'https://lens.invalid');
		for (const m of code.matchAll(STATIC_IMPORT)) add(new URL(m[1], base).pathname);
	}
	return queue;
}
