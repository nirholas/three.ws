import { describe, it, expect } from 'vitest';

import { receiptHTML } from '../src/shared/trade-receipt-view.js';

function receipt(source) {
	return {
		summary: 'Bought on a scout flag.',
		trigger: { label: 'Scout', detail: null },
		position: { opened_at: '2026-10-01T00:00:00Z', paper: false, share_url: null, token_url: null },
		legs: [],
		evidence: {
			scout: {
				score: 70,
				timing: 'before_entry',
				at: '2026-09-30T23:59:00Z',
				evidence: [{ type: 'news_match', platform: null, detail: 'Covered by a news feed', source }],
			},
		},
	};
}

describe('trade receipt evidence links', () => {
	it('renders an http(s) source as a link', () => {
		const html = receiptHTML(receipt('https://news.example/story'), { showLinks: false });
		expect(html).toContain('href="https://news.example/story"');
	});

	it('drops a script-scheme source instead of rendering it clickable', () => {
		const html = receiptHTML(receipt('javascript:alert(document.domain)'), { showLinks: false });
		expect(html).not.toContain('javascript:');
		expect(html).toContain('Covered by a news feed');
	});
});
