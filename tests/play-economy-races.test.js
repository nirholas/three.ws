// Double-spend, race and overflow guards on the authoritative /play economy
// handlers (general store buy/sell, bank, free spin). WalkRoom handlers are
// synchronous per message, so a burst of identical requests is the realistic
// "fast double click": every one must be priced from the server catalog, the
// purse must never go negative, and nothing may be charged for goods that did
// not land. The Colyseus runtime is skipped via Object.create, as the other
// walkroom-* suites do.

import { describe, it, expect, vi } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import { newProfile, bankTransfer, dropCarried, INV_SIZE, MAX_STACK } from '../multiplayer/src/economy.js';
import { buyEntry, sellPrice } from '../multiplayer/src/shop.js';
import { VENDOR_STALLS, ATMS, WHEEL } from '../multiplayer/src/world-features.js';
import { handleSpinFree, MIN_AVG_LEVEL } from '../multiplayer/src/spin-wheel.js';

function makeRoom({ at = VENDOR_STALLS[0], profile } = {}) {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', {
		value: { players: new Map([['s1', { x: at.x, z: at.z }]]) },
		writable: true,
		configurable: true,
	});
	const p = profile || newProfile('acct-race');
	room.econ = new Map([['s1', p]]);
	room._actionCounters = new Map();
	room._persistEcon = vi.fn();
	room._sendInv = vi.fn();
	room._sendProfile = vi.fn();
	room._announce = vi.fn();
	room._questEvent = vi.fn();
	const sent = [];
	const client = { sessionId: 's1', send: (type, msg) => sent.push({ type, msg }) };
	return { room, client, profile: p, sent };
}

// Fill every backpack slot with a non-stackable filler so nothing else fits.
function fillPack(profile, except = 0) {
	for (let i = 0; i < INV_SIZE - except; i++) profile.inv[i] = { item: 'rod', qty: 1 };
	for (let i = INV_SIZE - except; i < INV_SIZE; i++) profile.inv[i] = { item: '', qty: 0 };
}

describe('general store buy', () => {
	it('never charges for goods that did not fit in the pack', () => {
		const { room, client, profile } = makeRoom();
		const entry = buyEntry('ammo');
		profile.gold = 1000;
		fillPack(profile, 0);
		// One slot holds a nearly full ammo stack: only 3 of the 12 rounds fit.
		profile.inv[0] = { item: 'ammo', qty: MAX_STACK - 3 };

		room._handleStoreBuy(client, { item: 'ammo' });

		const held = profile.inv.filter((s) => s.item === 'ammo').reduce((n, s) => n + s.qty, 0);
		const landed = held - (MAX_STACK - 3);
		// Either the whole bundle lands and is charged in full, or nothing moves.
		if (landed === entry.qty) {
			expect(profile.gold).toBe(1000 - entry.price);
		} else {
			expect(landed).toBe(0);
			expect(profile.gold).toBe(1000);
		}
	});

	it('a burst of identical buys charges once per affordable bundle and never goes negative', () => {
		const { room, client, profile } = makeRoom();
		const entry = buyEntry('sword');
		profile.gold = entry.price; // exactly one sword
		for (let i = 0; i < 5; i++) room._handleStoreBuy(client, { item: 'sword' });
		expect(profile.gold).toBe(0);
		const swords = profile.inv.filter((s) => s.item === 'sword').length;
		expect(swords).toBe(1);
	});

	it('refuses to trade away from a store counter', () => {
		const { room, client, profile } = makeRoom({ at: { x: 9999, z: 9999 } });
		profile.gold = 500;
		room._handleStoreBuy(client, { item: 'sword' });
		expect(profile.gold).toBe(500);
	});

	it('ignores a client-supplied price', () => {
		const { room, client, profile } = makeRoom();
		profile.gold = 1000;
		room._handleStoreBuy(client, { item: 'axe', price: 1, qty: 99 });
		expect(profile.gold).toBe(1000 - buyEntry('axe').price);
	});
});

describe('general store sell', () => {
	it('a burst of sells of one stack pays for the stack exactly once', () => {
		const { room, client, profile } = makeRoom();
		profile.gold = 0;
		profile.inv[0] = { item: 'wood', qty: 10 };
		for (let i = 0; i < 5; i++) room._handleStoreSell(client, { slot: { zone: 'inv', i: 0 } });
		expect(profile.gold).toBe(10 * sellPrice('wood'));
		expect(profile.inv[0].item).toBe('');
	});

	it('a hostile quantity (huge, negative, fractional, NaN) cannot mint cash', () => {
		for (const qty of [2 ** 40, -5, 0.5, NaN, Infinity, 2 ** 31]) {
			const { room, client, profile } = makeRoom();
			profile.gold = 0;
			profile.inv[0] = { item: 'wood', qty: 4 };
			room._handleStoreSell(client, { slot: { zone: 'inv', i: 0 }, qty });
			expect(profile.gold).toBeLessThanOrEqual(4 * sellPrice('wood'));
			expect(profile.gold).toBeGreaterThanOrEqual(0);
		}
	});

	it('a huge but valid quantity sells the whole stack rather than silently nothing', () => {
		const { room, client, profile } = makeRoom();
		profile.gold = 0;
		profile.inv[0] = { item: 'wood', qty: 4 };
		room._handleStoreSell(client, { slot: { zone: 'inv', i: 0 }, qty: 2 ** 31 });
		expect(profile.gold).toBe(4 * sellPrice('wood'));
	});
});

describe('bank', () => {
	it('keeps purse and bank non-negative when the purse passes 2^31', () => {
		const p = newProfile('acct-big');
		p.gold = 3_000_000_000;
		p.bank = 10;
		bankTransfer(p, 1_000);
		expect(p.gold).toBe(3_000_000_000 - 1_000);
		expect(p.bank).toBe(1_010);
		expect(p.gold).toBeGreaterThanOrEqual(0);
		expect(p.bank).toBeGreaterThanOrEqual(0);
	});

	it('a death drop of a purse past 2^31 loses nothing', () => {
		const p = newProfile('acct-big2');
		p.gold = 3_000_000_000;
		const dropped = dropCarried(p);
		expect(dropped.gold).toBe(3_000_000_000);
		expect(p.gold).toBe(0);
	});

	it('a withdraw cannot push the purse past the 32-bit ceiling', () => {
		const p = newProfile('acct-cap');
		p.gold = 0xfffffff0;
		p.bank = 1000;
		bankTransfer(p, -1000);
		expect(p.gold).toBeLessThanOrEqual(0xffffffff);
		expect(p.gold + p.bank).toBe(0xfffffff0 + 1000);
	});

	it('a burst of deposits moves the purse once and never goes negative', () => {
		const { room, client, profile } = makeRoom({ at: ATMS[0] });
		profile.gold = 100;
		profile.bank = 0;
		for (let i = 0; i < 6; i++) room._handleBank(client, { amount: 100 });
		expect(profile.gold).toBe(0);
		expect(profile.bank).toBe(100);
	});
});

describe('free spin', () => {
	it('a burst of free spins awards exactly one prize', async () => {
		const { room, client, profile } = makeRoom({ at: WHEEL[0] });
		for (const skill of Object.keys(profile.levels)) profile.levels[skill] = MIN_AVG_LEVEL;
		room._actionOk = () => true;
		for (let i = 0; i < 6; i++) handleSpinFree(room, client);
		expect(room._persistEcon).toHaveBeenCalledTimes(1);
	});
});
