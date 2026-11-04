// @vitest-environment jsdom
//
// /3d showed "CHECKING..." forever for some visitors: the badge was a
// data-i18n-html container, so the async locale pass rebuilt its children via
// innerHTML and left the script holding a detached #liveText. The label must
// sit in its own plain data-i18n element so the live write survives.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { applyCatalog } from '../src/i18n.js';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = readFileSync(resolve(ROOT, 'public/3d.html'), 'utf8');
const EN = JSON.parse(readFileSync(resolve(ROOT, 'public/locales/en.json'), 'utf8'));
const t = (key) => {
	const [ns, ...rest] = key.split('.');
	return EN[ns]?.[rest.join('.')] ?? key;
};

function badgeMarkup() {
	const m = PAGE.match(/<span class="pill live" id="liveBadge"[\s\S]*?<\/span><\/span>/);
	return m[0];
}

describe('/3d live badge', () => {
	it('keeps the node the page script cached attached across a locale pass', () => {
		document.body.innerHTML = badgeMarkup();
		const cached = document.getElementById('liveText');
		applyCatalog(document, t);
		expect(document.getElementById('liveText')).toBe(cached);
	});

	it('does not revert a live value to "checking" on a later locale pass', () => {
		document.body.innerHTML = badgeMarkup();
		const text = document.getElementById('liveText');
		text.dataset.i18nOwned = '1';
		text.textContent = 'live';
		applyCatalog(document, t);
		expect(document.getElementById('liveText').textContent).toBe('live');
	});

	it('has an English catalog string for the checking label', () => {
		expect(EN['3d'].status_checking).toBe('checking…');
	});
});
