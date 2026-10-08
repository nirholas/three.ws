// @vitest-environment jsdom
//
// The full-page paywall takes its payment terms only from a live same-origin 402.
//
// It used to decode payTo, amount and resource from the `?req=` query string, so
// anyone could mail out a three.ws-branded /paywall.html link whose "Pay" button
// paid the link author's own wallet. The page now re-fetches the challenge from
// the same-origin `?return=` path and never reads `req`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'public/paywall.js'), 'utf8');

const ATTACKER = 'AttackerWa11et1111111111111111111111111111111';
const PLATFORM = 'P1atformPayTo1111111111111111111111111111111';

function forgedReq() {
	const accepts = [{ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: ATTACKER, amount: '1000000000', asset: 'USDC' }];
	return Buffer.from(JSON.stringify(accepts)).toString('base64url');
}

function mountPage(search) {
	document.body.innerHTML = '<span id="service-name"></span><span id="price-amount"></span><pre id="raw-json"></pre><a id="close-btn"></a><div id="pay-card"></div>';
	window.history.replaceState({}, '', `/paywall.html${search}`);
}

async function boot() {
	// eslint-disable-next-line no-new-func
	new Function(SRC)();
	document.dispatchEvent(new Event('DOMContentLoaded'));
	await new Promise((r) => setTimeout(r, 0));
	await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('paywall payment terms', () => {
	it('never reads the ?req= query parameter', () => {
		expect(SRC).not.toMatch(/get\('req'\)/);
	});

	it('renders the terms from the same-origin 402, not the forged ?req=', async () => {
		const fetchMock = vi.fn(async () => new Response(
			JSON.stringify({ x402Version: 2, accepts: [{ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: PLATFORM, amount: '10000', asset: 'USDC' }] }),
			{ status: 402, headers: { 'content-type': 'application/json' } },
		));
		vi.stubGlobal('fetch', fetchMock);
		mountPage(`?req=${forgedReq()}&return=%2Fapi%2Fx402%2Fecho`);
		await boot();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/x402/echo');
		const raw = document.getElementById('raw-json').textContent;
		expect(raw).toContain(PLATFORM);
		expect(raw).not.toContain(ATTACKER);
	});

	it('refuses a cross-origin or protocol-relative return target without fetching it', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		for (const ret of ['https%3A%2F%2Fevil.example%2Fpay', '%2F%2Fevil.example%2Fpay', '%2F%5Cevil.example']) {
			mountPage(`?req=${forgedReq()}&return=${ret}`);
			await boot();
			expect(document.getElementById('raw-json').textContent).not.toContain(ATTACKER);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
