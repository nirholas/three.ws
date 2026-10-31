// The i18n runtime swaps every annotated element's text for its en.json value,
// even in English. i18n:extract only fills NEW keys, so a copy edit to an
// existing key leaves en.json holding the old sentence and the page renders
// stale copy. Partner and programme claims are where that hurts most: /press
// kept rendering a boilerplate without the Microsoft partnership after the HTML
// had been updated. These pages carry partner claims, so their catalog values
// must match the HTML exactly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFromHtml } from '../scripts/i18n-extract.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const en = JSON.parse(readFileSync(resolve(ROOT, 'public/locales/en.json'), 'utf8'));

const PAGES = ['pages/press/index.html', 'pages/partners.html'];

function catalogValue(key) {
	const dot = key.indexOf('.');
	return dot === -1 ? en[key] : en[key.slice(0, dot)]?.[key.slice(dot + 1)];
}

describe('partner copy stays in sync with the en.json catalog', () => {
	for (const page of PAGES) {
		it(`${page}: every annotated string matches its en.json value`, () => {
			const html = readFileSync(resolve(ROOT, page), 'utf8');
			const stale = [];
			for (const [key, value] of extractFromHtml(html)) {
				const cataloged = catalogValue(key);
				if (cataloged !== undefined && cataloged !== value) stale.push({ key, html: value, en: cataloged });
			}
			expect(stale).toEqual([]);
		});
	}

	it('the Microsoft partnership renders on /press and /partners', () => {
		expect(catalogValue('press_index.openai_select_partner_in_the_openai_partner')).toContain('live on Microsoft Marketplace');
		expect(catalogValue('partners.meta_description')).toContain('Microsoft');
		expect(catalogValue('partners.three_ws_and_microsoft_have_announced_a')).toContain('live on Microsoft Marketplace');
	});
});
