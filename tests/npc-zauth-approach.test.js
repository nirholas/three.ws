// @vitest-environment jsdom
//
// Walking past a vendor must never take the screen. zauth is the only NPC in
// the catalog with an `onApproach` handler, and it used to open its RepoScan
// panel from proximity alone: crossing the plaza in /play threw a modal over
// the world nobody asked for. Approach now only greets and warms the live 402
// probe; the panel belongs to E and to clicks. This locks that split in.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.self = globalThis;

const CHALLENGE = {
	x402Version: 2,
	accepts: [{ amount: '50000', network: 'solana:mainnet', asset: 'USDC' }],
};

function fakeNpc() {
	return { say: vi.fn(), emote: vi.fn(), _disposed: false };
}

let zauth;

beforeEach(async () => {
	globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(CHALLENGE), {
		status: 402,
		headers: { 'content-type': 'application/json' },
	}));
	const { npcCatalogFor } = await import('../src/game/npc/npc-catalog.js');
	zauth = npcCatalogFor().find((n) => n.id === 'npc-zauth');
});

afterEach(() => {
	document.querySelector('.npc-svc-overlay')?.remove();
	document.body.innerHTML = '';
	vi.resetModules();
	vi.restoreAllMocks();
});

describe('zauth NPC walk-up', () => {
	it('is in the catalog with both an approach line and an E prompt', () => {
		expect(zauth).toBeTruthy();
		expect(typeof zauth.onApproach).toBe('function');
		expect(typeof zauth.onInteract).toBe('function');
		expect(zauth.prompt).toBeTruthy();
	});

	it('greets on approach without opening any panel', async () => {
		const npc = fakeNpc();
		zauth.onApproach({ npc, ui: {} });
		await Promise.resolve();
		expect(npc.say).toHaveBeenCalledTimes(1);
		expect(document.querySelector('.npc-svc-overlay')).toBeNull();
		expect(document.querySelector('.npc-svc-card.is-zauth')).toBeNull();
	});

	// Walking past is not a request. The probe used to fire on approach, so a
	// player crossing the plaza drew a network call (and, once zauth retired the
	// endpoint, a 410 console error) without ever asking for a scan.
	it('makes no network call on approach', async () => {
		zauth.onApproach({ npc: fakeNpc(), ui: {} });
		await Promise.resolve();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('probes the live x402 challenge once when the scanner opens', async () => {
		zauth.onInteract({ npc: fakeNpc(), ui: {} });
		expect(document.querySelector('.npc-svc-card.is-zauth')).toBeTruthy();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
		const [url, init] = globalThis.fetch.mock.calls[0];
		expect(url).toBe('/api/zauth-reposcan');
		expect(init.method).toBe('POST');
	});
});

// zauth answered the unpaid probe with 410 on 2026-11-03: they retired the
// pay-per-scan endpoint. The panel used to read "price check failed, retry in
// a moment" over a live repo input, an offer that can never be paid.
describe('zauth scanner after the upstream retired', () => {
	const RETIRED = 'The x402 pay-per-scan endpoint has been retired.';

	beforeEach(() => {
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: RETIRED }), {
			status: 410,
			headers: { 'content-type': 'application/json' },
		}));
	});

	it('shows a closed scanner with no repo input and does not keep probing', async () => {
		zauth.onInteract({ npc: fakeNpc(), ui: {} });
		const card = document.querySelector('.npc-svc-card.is-zauth');
		await vi.waitFor(() => expect(card.querySelector('.zauth-retired')).toBeTruthy());
		expect(card.querySelector('.zauth-retired').textContent).toContain(RETIRED);
		expect(card.querySelector('.npc-svc-input')).toBeNull();
		expect(card.textContent).not.toMatch(/retry in a moment/i);
		expect(card.querySelector('.zauth-live').textContent).toBe('CLOSED');

		document.querySelector('.npc-svc-close').click();
		await new Promise((r) => setTimeout(r, 200));
		zauth.onInteract({ npc: fakeNpc(), ui: {} });
		await vi.waitFor(() => expect(document.querySelector('.zauth-retired')).toBeTruthy());
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it('says the scanner is closed on approach once the retirement is known', async () => {
		zauth.onInteract({ npc: fakeNpc(), ui: {} });
		await vi.waitFor(() => expect(document.querySelector('.zauth-retired')).toBeTruthy());
		const npc = fakeNpc();
		zauth.onApproach({ npc, ui: {} });
		expect(npc.say.mock.calls[0][0]).toMatch(/closed/i);
		expect(npc.say.mock.calls[0][0]).not.toMatch(/five cents/i);
	});
});
