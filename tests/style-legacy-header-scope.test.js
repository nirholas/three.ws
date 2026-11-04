// @vitest-environment jsdom
// public/style.css paints a fixed-height, overflow-clipped app bar onto bare
// <header> elements (the legacy 3D viewer chrome). A page's own card or section
// header inside <main>/<section> is also a bare <header>, and the rule clipped
// its controls: /mcp-integrations lost half its agent picker and "Add by URL"
// button, /settings/memory its card subtitles. The rule must keep matching the
// top-level chrome and never a header nested in sectioning content.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(process.cwd(), 'public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Top-level commas only: `:is(main, section)` stays one selector.
function splitSelectorList(list) {
	const out = [];
	let depth = 0;
	let cur = '';
	for (const ch of list) {
		if (ch === '(') depth += 1;
		else if (ch === ')') depth -= 1;
		if (ch === ',' && depth === 0) {
			out.push(cur.trim());
			cur = '';
		} else cur += ch;
	}
	out.push(cur.trim());
	return out;
}

// Every selector list whose rule sets the app-bar height for bare headers.
function appBarSelectors() {
	const out = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(CSS))) {
		const body = m[2];
		if (!/(^|;|\s)height\s*:/.test(body)) continue;
		for (const sel of splitSelectorList(m[1])) {
			if (/(^|\s)header:not\(\[class\]\)/.test(sel)) out.push(sel);
		}
	}
	return out;
}

function headerIn(markup) {
	document.body.innerHTML = markup;
	return document.getElementById('h');
}

describe('legacy header rule scope in public/style.css', () => {
	const selectors = appBarSelectors();

	it('finds the app-bar rules (desktop and narrow)', () => {
		expect(selectors.length).toBeGreaterThanOrEqual(2);
	});

	it.each([
		['a direct child of body', '<header id="h"><h1>three.ws</h1></header>'],
		['inside a layout div', '<div class="viewer"><header id="h"></header></div>'],
	])('still styles the legacy chrome header %s', (_label, markup) => {
		const h = headerIn(markup);
		for (const sel of selectors) expect(h.matches(sel), sel).toBe(true);
	});

	it.each([
		['a section card', '<main><section class="mi-card"><header id="h"><h2>Connected</h2></header></section></main>'],
		['an article', '<article><header id="h"></header></article>'],
		['main', '<main><header id="h"></header></main>'],
		['a dialog', '<dialog><header id="h"></header></dialog>'],
	])('leaves a header nested in %s alone', (_label, markup) => {
		const h = headerIn(markup);
		for (const sel of selectors) expect(h.matches(sel), sel).toBe(false);
	});
});
