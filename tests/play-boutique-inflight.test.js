// @vitest-environment jsdom
// A boutique purchase is a real $THREE payment the player signs in their wallet,
// and the flight from click to on-chain confirmation takes seconds. Any profile
// or inventory snapshot that lands in that window (a gather, a gold tick, another
// player's trade echo) re-renders the cosmetics panel, which used to rebuild the
// card without its busy marker, so a second click opened a SECOND purchase and
// the player could sign two payments for one item. One purchase may be in flight
// at a time for the whole panel, and the re-rendered card must still show it.
//
// Drives the real PlaySystems._buyPremium and the real boutique-purchase module.
// The only stand-in is the injected browser wallet (window.solana), which is how
// the page meets Phantom anyway. Each purchase flight sends exactly one
// boutiqueQuote, so counting those counts purchases.
import { describe, it, expect, beforeEach } from 'vitest';
import { PlaySystems } from '../src/game/play-systems.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The purchase module is a lazy import, so the first flight reaches the quote a
// few ticks after the click.
async function until(fn, ms = 10_000) {
	const start = Date.now();
	while (!fn()) {
		if (Date.now() - start > ms) throw new Error('timed out');
		await sleep(10);
	}
}

function harness() {
	const quotes = [];
	const handlers = new Map();
	const net = {
		status: 'online',
		// Mirrors CommunityNet: true when the intent reached an open socket.
		boutiqueQuote(id) { quotes.push(id); return true; },
		on(type, fn) {
			if (!handlers.has(type)) handlers.set(type, new Set());
			handlers.get(type).add(fn);
			return () => handlers.get(type)?.delete(fn);
		},
		emit(type, msg) { for (const fn of handlers.get(type) || []) fn(msg); },
	};
	const toasts = [];
	const sys = Object.create(PlaySystems.prototype);
	sys.net = net;
	sys.ui = { toast: (text, tone) => toasts.push([tone, text]) };
	return { sys, net, quotes, toasts };
}

const ITEM = { id: 'aura-gold', name: 'Gold Aura', price: 50 };
const card = () => { const c = document.createElement('div'); c.className = 'ps-cos-card is-locked'; return c; };

beforeEach(() => {
	window.solana = { isPhantom: true, publicKey: { toString: () => 'THREEsynthetic1111111111111111111111111111' } };
});

describe('boutique purchase: one flight at a time', () => {
	it('a double click on the same card starts one purchase', async () => {
		const { sys, quotes } = harness();
		const c = card();
		sys._buyPremium(ITEM, c);
		sys._buyPremium(ITEM, c);
		await until(() => quotes.length > 0);
		await sleep(200);
		expect(quotes).toEqual(['aura-gold']);
	});

	it('a click on the re-rendered card while the first is in flight starts no second purchase', async () => {
		const { sys, quotes } = harness();
		sys._buyPremium(ITEM, card());
		await until(() => quotes.length > 0);
		// A snapshot re-rendered the panel: brand-new card element, no busy class.
		const rerendered = card();
		sys._buyPremium(ITEM, rerendered);
		sys._buyPremium({ id: 'hat-crown', name: 'Crown', price: 80 }, card());
		await sleep(200);
		expect(quotes).toEqual(['aura-gold']);
	});

	it('the flight ending (here a refused quote) frees the panel for the next purchase', async () => {
		const { sys, net, quotes, toasts } = harness();
		const first = sys._buyPremium(ITEM, card());
		await until(() => quotes.length > 0);
		net.emit('notice', { kind: 'boutique', text: 'Not enough $THREE for Gold Aura.' });
		await first;
		expect(toasts.at(-1)).toEqual(['warn', 'Not enough $THREE for Gold Aura.']);
		sys._buyPremium(ITEM, card());
		await until(() => quotes.length > 1);
		expect(quotes).toEqual(['aura-gold', 'aura-gold']);
	});
});
