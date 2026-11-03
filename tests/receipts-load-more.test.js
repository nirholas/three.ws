// @vitest-environment jsdom
// The /receipts "Load more" pager: a heavy buyer holds more than one 200-row
// page, and a failed page fetch must say so without discarding what is shown.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('pages/receipts.html', 'utf8');
const bodyHtml = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');

function receipt(id) {
	return {
		id,
		resourceUrl: `https://three.ws/api/x402/thing-${id}`,
		network: 'solana',
		transaction: `tx${id}`,
		amount: '1000000',
		assetSymbol: 'USDC',
		assetDecimals: 6,
		issuedAt: new Date().toISOString(),
	};
}

function jsonResponse(body, status = 200) {
	return { ok: status < 400, status, json: async () => body };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('receipts load more', () => {
	beforeEach(() => {
		vi.resetModules();
		document.body.innerHTML = bodyHtml.replace(/^<body[^>]*>/, '');
		sessionStorage.setItem(
			'twx_receipts_session',
			JSON.stringify({ address: 'So1anaAddr', network: 'solana', signature: 'sig', issuedAt: new Date().toISOString() }),
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		sessionStorage.clear();
	});

	async function boot(fetchMock) {
		vi.stubGlobal('fetch', fetchMock);
		await import('../src/receipts.js');
		await flush();
	}

	it('appends the next page when the pager button is pressed', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ receipts: [receipt('a')], nextCursor: 'c1', summary: null }))
			.mockResolvedValueOnce(jsonResponse({ receipts: [receipt('b')], nextCursor: null, summary: null }));
		await boot(fetchMock);
		expect(document.getElementById('rc-more-wrap').hidden).toBe(false);
		document.getElementById('rc-more').click();
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=c1');
		expect(document.querySelectorAll('#rc-list .rc-row').length).toBe(2);
		expect(document.getElementById('rc-more-wrap').hidden).toBe(true);
	});

	it('shows a recoverable error and keeps the loaded rows when the next page fails', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ receipts: [receipt('a')], nextCursor: 'c1', summary: null }))
			.mockResolvedValueOnce(jsonResponse({ error_description: 'Receipt service is busy.' }, 503));
		await boot(fetchMock);
		const btn = document.getElementById('rc-more');
		const idle = btn.querySelector('.rc-btn-label').textContent;
		btn.click();
		expect(btn.disabled).toBe(true);
		expect(btn.querySelector('.rc-btn-label').textContent).toBe('Loading…');
		await flush();
		expect(document.getElementById('rc-load-error').hidden).toBe(false);
		expect(document.getElementById('rc-load-error-msg').textContent).toBe('Receipt service is busy.');
		expect(document.querySelectorAll('#rc-list .rc-row').length).toBe(1);
		expect(btn.disabled).toBe(false);
		expect(btn.querySelector('.rc-btn-label').textContent).toBe(idle);
	});
});
