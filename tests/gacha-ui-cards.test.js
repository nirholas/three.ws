// @vitest-environment jsdom
// "My cards" in the /play gacha modal (src/game/gacha-ui.js), driven through the
// real modal with only the network and the wallet stubbed at the boundary.
//
// What must hold: opening My cards while the machine list is still loading
// never gets overwritten by that list arriving late, and a wallet larger than
// one page reaches every card through "Show more" and a whole-wallet search.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const OWNER = 'Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu';

function card(i) {
	return { address: `card${i}`, name: `Card ${i}`, image: '', tier: null, grader: 'PSA', grade: '10', insuredValue: 10, standard: 'core', buyback: { available: i === 2, amountUsdc: '9.30' } };
}

function page(offset, { total = 130, q = '' } = {}) {
	const cards = Array.from({ length: Math.min(60, total - offset) }, (_, k) => card(offset + k));
	const nextOffset = offset + cards.length < total ? offset + cards.length : null;
	return { ok: true, owner: OWNER, q, cards, count: cards.length, offset, nextOffset, pageSize: 60, total, walletTotal: 130, partial: false, fetchedAt: new Date().toISOString() };
}

// The shape /api/gacha/machines serves (normalizeMachine in api/_lib/collectorcrypt-gacha.js).
const MACHINE = {
	code: 'pokemon_25', name: 'Starter Pokemon Gacha Pack', shortName: 'PKMN 25', category: 'Pokemon', price: 25, art: '', thumbnail: '', video: null,
	instantBuyback: 85, turboMode: true,
	odds: { epic: 0.01, rare: 0.04, uncommon: 0.2, common: 0.75 },
	tierRanges: { epic: { start: 125, end: 500 }, rare: { start: 55, end: 125 }, uncommon: { start: 30, end: 55 }, common: { start: 13, end: 30 } },
	stock: { epic: 200, rare: 216, uncommon: 210, common: 342 }, totalStock: 968, ev: 27.51, order: 14, available: true,
};

const json = (body) => ({ ok: true, status: 200, json: async () => body });
const flush = async (n = 8) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

let releaseMachines;
let cardsCalls;

beforeEach(() => {
	vi.resetModules();
	document.body.replaceChildren();
	cardsCalls = [];
	const pk = { toString: () => OWNER, toBase58: () => OWNER };
	window.phantom = { solana: { isPhantom: true, publicKey: pk, isConnected: true, connect: async () => ({ publicKey: pk }), on() {}, off() {}, removeListener() {} } };
	window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
	window.requestAnimationFrame ||= (fn) => setTimeout(fn, 0);
	vi.stubGlobal('fetch', vi.fn((url) => {
		const u = new URL(url, 'http://localhost');
		if (u.pathname === '/api/gacha/machines') return new Promise((resolve) => (releaseMachines = () => resolve(json({ ok: true, machines: [MACHINE], usdcMint: null }))));
		if (u.pathname === '/api/gacha/cards') {
			cardsCalls.push(Object.fromEntries(u.searchParams));
			const q = u.searchParams.get('q') || '';
			if (q) return Promise.resolve(json({ ...page(0, { total: 1, q }), cards: [card(7)], count: 1, total: 1, nextOffset: null }));
			return Promise.resolve(json(page(Number(u.searchParams.get('offset') || 0))));
		}
		return Promise.resolve(json({ ok: true }));
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete window.phantom;
});

async function openCards() {
	const { openGacha } = await import('../src/game/gacha-ui.js');
	const ui = openGacha();
	ui.cardsBtn.click();
	await flush();
	return ui;
}

describe('gacha My cards', () => {
	it('keeps My cards on screen when the machine list arrives after it', async () => {
		const ui = await openCards();
		expect(ui.view).toBe('cards');
		expect(document.querySelectorAll('.ga-own').length).toBe(60);
		releaseMachines();
		await flush();
		expect(ui.view).toBe('cards');
		expect(document.querySelectorAll('.ga-own').length).toBe(60);
		expect(document.querySelector('.ga-tile')).toBeNull();
	});

	it('reaches every card of a wallet larger than one page through Show more', async () => {
		const ui = await openCards();
		expect(document.querySelector('.ga-stat-v').textContent).toBe('130');
		document.querySelector('.ga-cards-more .ga-more').click();
		await flush();
		document.querySelector('.ga-cards-more .ga-more').click();
		await flush();
		expect(cardsCalls.map((c) => c.offset || '0')).toEqual(['0', '60', '120']);
		const tiles = [...document.querySelectorAll('.ga-own')];
		expect(tiles.length).toBe(130);
		expect(document.querySelector('.ga-cards-more .ga-more')).toBeNull();
		expect(document.querySelector('.ga-cards-more').textContent).toContain('All 130 cards shown');
		// The sellable card is pulled to the top section, once.
		expect(document.querySelectorAll('.ga-cards-sell .ga-own').length).toBe(1);
		expect(ui.view).toBe('cards');
		ui.close?.();
	});

	it('searches the whole wallet, and offers a way back from no matches', async () => {
		await openCards();
		const input = document.querySelector('.ga-search-input');
		expect(input).not.toBeNull();
		input.value = 'card 7';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await flush();
		expect(cardsCalls.at(-1)).toMatchObject({ q: 'card 7' });
		expect([...document.querySelectorAll('.ga-own-name')].map((n) => n.textContent)).toEqual(['Card 7']);
		expect(document.querySelector('.ga-stat-l').textContent).toBe('match');
	});
});
