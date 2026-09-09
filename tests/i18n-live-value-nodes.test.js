// @vitest-environment jsdom
//
// A `data-i18n-html` value is put back through innerHTML, which destroys every
// child node inside the annotated element and rebuilds it from the catalog
// string. A page script that cached one of those children (the usual
// `const el = document.getElementById(...)` at boot) is left holding a detached
// node from that moment on: its writes still succeed, they just land nowhere,
// and the visible value freezes at whatever literal the translator wrote.
//
// That shipped on /pump-visualizer. Its status bar read
// `<span data-i18n-html="pump_visualizer.0_tokens"><b id="vz-stat-count">0</b>
// tokens</span>`, so roughly fifteen seconds into every session (as soon as the
// async /api/locale fetch resolved) the live mint counter froze at the catalog's
// placeholder "0" while the scene behind it kept filling with coins. The same
// swap froze the per-minute rate and the total market cap.
//
// The fix is structural, not a re-query: a value the script owns never sits
// inside a translated container. The label gets its own element with plain
// `data-i18n` (textContent, which leaves the sibling nodes alone) and the live
// `<b>` is that label's sibling. These tests pin both halves: the general
// property for the page, and the mechanism that broke it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import { applyCatalog } from '../src/i18n.js';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = readFileSync(resolve(ROOT, 'pages/pump-visualizer.html'), 'utf8');
const EN = JSON.parse(readFileSync(resolve(ROOT, 'public/locales/en.json'), 'utf8'));

// The catalog function the runtime hands applyCatalog: "ns.key" → string.
const catalog = (locale) => (key) => {
	const [ns, ...rest] = key.split('.');
	const hit = locale[ns]?.[rest.join('.')];
	return hit === undefined ? key : hit;
};

// The status bar alone, lifted out of the 3000-line page: jsdom never has to
// parse (or fail to run) the WebGL module below it.
function statusBar() {
	const match = PAGE.match(/<div class="vz-overlay vz-status"[\s\S]*?<\/div>/);
	expect(match, 'the status bar markup should still be in the page').toBeTruthy();
	document.body.innerHTML = match[0];
	return document.body;
}

// Every id /pump-visualizer writes a live number into.
const LIVE_VALUE_IDS = ['vz-stat-count', 'vz-stat-rate', 'vz-stat-mcap'];

describe('pump-visualizer status bar survives the i18n catalog pass', () => {
	it('keeps the node identity of every live value across a translation', () => {
		const root = statusBar();
		const before = LIVE_VALUE_IDS.map((id) => root.querySelector(`#${id}`));
		expect(before.every(Boolean), 'every live value element should exist').toBe(true);

		// The page's script writes real values, then the locale fetch resolves.
		before.forEach((el, i) => { el.textContent = String(41 + i); });
		applyCatalog(document, catalog(EN));

		before.forEach((el, i) => {
			expect(el.isConnected, `#${LIVE_VALUE_IDS[i]} must stay in the document`).toBe(true);
			expect(root.querySelector(`#${LIVE_VALUE_IDS[i]}`)).toBe(el);
			expect(el.textContent).toBe(String(41 + i));
		});
	});

	it('still localizes the labels around those values', () => {
		const root = statusBar();
		applyCatalog(document, catalog({
			pump_visualizer: { tokens_label: 'Tokens', total_label: 'gesamt', per_minute_label: '/Min' },
		}));
		expect(root.textContent).toContain('Tokens');
		expect(root.textContent).toContain('gesamt');
		expect(root.querySelector('#vz-stat-rate-per-min').textContent).toBe('/Min');
	});

	it('holds no live value inside a data-i18n-html container anywhere on the page', () => {
		document.body.innerHTML = PAGE.replace(/<script[\s\S]*?<\/script>/g, '');
		for (const host of document.querySelectorAll('[data-i18n-html]')) {
			for (const id of LIVE_VALUE_IDS) {
				expect(
					host.querySelector(`#${id}`),
					`#${id} is script-owned and must not sit inside data-i18n-html="${host.getAttribute('data-i18n-html')}"`,
				).toBeNull();
			}
		}
	});

	it('is the mechanism that broke it: innerHTML detaches a cached child', () => {
		document.body.innerHTML = '<span data-i18n-html="ns.stat"><b id="live">0</b> tokens</span>';
		const cached = document.getElementById('live');
		cached.textContent = '72';
		applyCatalog(document, catalog({ ns: { stat: '<b id="live">0</b> tokens' } }));
		expect(cached.isConnected).toBe(false);
		expect(document.getElementById('live').textContent).toBe('0');
	});
});
