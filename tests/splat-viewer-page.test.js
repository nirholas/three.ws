// @vitest-environment jsdom
//
// The Splat Viewer page and its module have to agree on element ids, and
// nothing in the build checks that. Three defects shipped from that gap and
// were live in production until this test landed:
//
//   1. `setLoading`/`setError` wrote their detail line into `#sp-loading-detail`
//      and `#sp-error-detail`. The page calls those nodes `#sp-loading-sub` and
//      `#sp-error-sub`, so every write landed on null. A failed load rendered a
//      heading over an empty space, and the one sentence telling the visitor
//      what to do (download the file and upload it when a host blocks CORS)
//      was never shown.
//   2. `setHud` wrote the scene label with `hud.textContent = label`. `#sp-hud`
//      is the container that also holds the recenter button and the download
//      link, so the first successful render deleted both controls from the DOM
//      and every later query for them returned null.
//   3. The state strings the script writes sit on nodes the markup annotates
//      for translation. src/i18n.js reverts those unless the script claims the
//      node with `data-i18n-owned`, so "Sorting splats" snapped back to the
//      catalog's "Loading splat engine" seconds into every load.
//
// The first test is the general property: every id the module writes to must
// exist in the page. The rest pin the two mechanisms.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import { applyCatalog } from '../src/i18n.js';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = readFileSync(resolve(ROOT, 'pages/splat.html'), 'utf8');
const MODULE = readFileSync(resolve(ROOT, 'src/splat-viewer.js'), 'utf8');

/** Ids the page markup defines. */
function pageIds() {
	return new Set([...PAGE.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/** Ids the module looks up through its `$('#…')` helper. */
function moduleIds() {
	return [...MODULE.matchAll(/\$\(`?#([a-z0-9-]+)/gi)].map((m) => m[1]);
}

const catalog = (locale) => (key) => {
	const [ns, ...rest] = key.split('.');
	const hit = locale[ns]?.[rest.join('.')];
	return hit === undefined ? key : hit;
};

function stage() {
	const match = PAGE.match(/<div class="sp-stage" id="sp-stage">[\s\S]*?\n\t\t\t\t\t<\/div>/);
	expect(match, 'the stage markup should still be in the page').toBeTruthy();
	document.body.innerHTML = match[0];
	return document.body;
}

describe('splat viewer page and module agree', () => {
	it('defines every element id the module writes to', () => {
		const defined = pageIds();
		const missing = [...new Set(moduleIds())].filter((id) => !defined.has(id));
		expect(missing, `pages/splat.html is missing ids used by src/splat-viewer.js: ${missing.join(', ')}`).toEqual([]);
	});

	it('gives the HUD label its own node, separate from the HUD controls', () => {
		const root = stage();
		const hud = root.querySelector('#sp-hud');
		const label = root.querySelector('#sp-hud-label');
		const recenter = root.querySelector('#sp-recenter');
		const download = root.querySelector('#sp-download');
		expect(label, '#sp-hud-label must exist').toBeTruthy();
		expect(recenter && download, 'the HUD must carry a recenter control and a download link').toBeTruthy();
		expect(label.contains(recenter), 'the controls must not live inside the label node').toBe(false);

		// What the module does on going live: write the label, leave the controls.
		label.textContent = 'Synthetic head bust · 14,000 splats';
		expect(hud.querySelector('#sp-recenter')).toBe(recenter);
		expect(hud.querySelector('#sp-download')).toBe(download);
	});

	it('never writes the scene label onto the HUD container itself', () => {
		expect(MODULE).not.toMatch(/hud\.textContent\s*=/);
	});

	it('keeps a script-written state string across the catalog pass', () => {
		const root = stage();
		const title = root.querySelector('#sp-loading-title');
		const sub = root.querySelector('#sp-loading-sub');
		expect(title.hasAttribute('data-i18n'), 'the loading title ships a translated placeholder').toBe(true);

		// setText(): write the live value and claim the node, as the module does.
		for (const [node, value] of [[title, 'Sorting splats…'], [sub, '14,000 splats']]) {
			node.textContent = value;
			node.dataset.i18nOwned = '1';
		}
		applyCatalog(document, catalog(JSON.parse(readFileSync(resolve(ROOT, 'public/locales/en.json'), 'utf8'))));

		expect(title.textContent).toBe('Sorting splats…');
		expect(sub.textContent).toBe('14,000 splats');
	});

	it('still translates the state copy that no script has claimed', () => {
		const root = stage();
		applyCatalog(document, catalog({ splat: { load_a_splat_to_begin: 'Lade ein Splat' } }));
		expect(root.querySelector('#sp-idle h3').textContent).toBe('Lade ein Splat');
	});

	it('shows a loading state before awaiting the splat engine', () => {
		// requireSpark() paints first and awaits second; a bare `await loadSpark()`
		// at an entry point is the regression (the click looked like a dead button
		// for as long as the multi-megabyte engine took to arrive).
		expect(MODULE).toMatch(/async function requireSpark\(/);
		expect(MODULE.match(/await loadSpark\(\)/g) || []).toHaveLength(1);
	});
});
