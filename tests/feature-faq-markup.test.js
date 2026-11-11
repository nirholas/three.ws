// FAQPage markup is only eligible for rich results when every question it
// declares is on the page for a reader too. The feature pages carry their FAQ
// twice (the visible accordion and the JSON-LD), and the copies had drifted:
// /features/ar declared five questions none of which the page showed, so Bing
// and Google read the markup as hidden content. audit:seo flags a page where
// none match; this guard holds every curated feature page to all of them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { faqVisibility } from '../api/_lib/structured-data.js';

// Pages whose FAQ markup and visible accordion agree question for question.
const ALIGNED = ['ar', 'forge', 'scan', 'studio', 'walk'];

describe('feature page FAQ markup', () => {
	for (const page of ALIGNED) {
		it(`/features/${page} declares only questions the page shows`, () => {
			const html = readFileSync(new URL(`../pages/features/${page}.html`, import.meta.url), 'utf8');
			const v = faqVisibility(html);
			expect(v.questions.length).toBeGreaterThan(0);
			expect(v.hidden).toEqual([]);
		});
	}

	it('/features/marketplace shows the question its markup leads with', () => {
		const html = readFileSync(new URL('../pages/features/marketplace.html', import.meta.url), 'utf8');
		const v = faqVisibility(html);
		expect(v.visible).toContain('What does forking an agent actually copy?');
	});
});
