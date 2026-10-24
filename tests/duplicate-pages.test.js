import { describe, it, expect } from 'vitest';
import { findDuplicatePaths } from '../scripts/lib/duplicate-pages.mjs';

// order 419: /grok and /docs/creator-payouts each shipped twice in
// data/pages.json and produced two <loc> rows for the same URL in the live
// sitemap. audit-page-index.mjs uses findDuplicatePaths to fail fast on any
// future repeat of that mistake.

describe('findDuplicatePaths', () => {
	it('reports nothing for a pages tree with no duplicate path', () => {
		const pages = {
			sections: [
				{
					id: 'main',
					pages: [
						{ path: '/grok', title: 'A' },
						{ path: '/docs/creator-payouts', title: 'B' },
					],
				},
			],
		};
		expect(findDuplicatePaths(pages)).toEqual([]);
	});

	it('flags a path that appears twice in the same section, even with different titles', () => {
		const pages = {
			sections: [
				{
					id: 'main',
					pages: [
						{ path: '/grok', title: 'three.ws for Grok' },
						{ path: '/x/claim', title: 'Claim your X creations' },
						{ path: '/grok', title: 'three.ws for Grok Bot: a free 3D studio and a body for Grok' },
					],
				},
			],
		};
		const duplicates = findDuplicatePaths(pages);
		expect(duplicates).toEqual([{ path: '/grok', count: 2, lines: [] }]);
	});

	it('flags a path duplicated across two different sections', () => {
		const pages = {
			sections: [
				{ id: 'main', pages: [{ path: '/docs/creator-payouts', title: 'Docs · Creator payouts' }] },
				{ id: 'docs', pages: [{ path: '/docs/creator-payouts', title: 'Docs · Creator payouts' }] },
			],
		};
		const duplicates = findDuplicatePaths(pages);
		expect(duplicates).toEqual([{ path: '/docs/creator-payouts', count: 2, lines: [] }]);
	});

	it('resolves 1-indexed line numbers from the raw source text when given', () => {
		const pages = { sections: [{ id: 'main', pages: [{ path: '/grok' }, { path: '/grok' }] }] };
		const rawText = [
			'{',
			'  "sections": [',
			'    { "id": "main", "pages": [',
			'      { "path": "/grok" },',
			'      { "path": "/grok" }',
			'    ] }',
			'  ]',
			'}',
		].join('\n');
		expect(findDuplicatePaths(pages, rawText)).toEqual([{ path: '/grok', count: 2, lines: [4, 5] }]);
	});

	it('does not flag a path that appears once', () => {
		const pages = { sections: [{ id: 'main', pages: [{ path: '/irl/sign' }] }] };
		expect(findDuplicatePaths(pages)).toEqual([]);
	});
});
