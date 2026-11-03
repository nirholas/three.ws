// Price and odds truth for /play. The published reference (GET /api/play/economy,
// rendered at /play/economy) must agree with what the authoritative WalkRoom
// actually charges and pays, and with the wedge table the wheel UI is sent. The
// reference imports its numbers from the same modules, so a mismatch here means
// one side drifted (or a client string was transcribed and went stale).

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import { newProfile, INV_SIZE, MAX_STACK, HOTBAR_SIZE, LEVEL_CAP } from '../multiplayer/src/economy.js';
import { VENDOR_STALLS, WHEEL } from '../multiplayer/src/world-features.js';
import {
	WHEEL_SEGMENTS, SPIN_COST_USD, MIN_AVG_LEVEL, FREE_SPIN_COOLDOWN_MS, handleSpinInfo,
} from '../multiplayer/src/spin-wheel.js';
import { boutiquePrice } from '../multiplayer/src/shop.js';

const { default: handler } = await import('../api/play/economy.js');

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function readEconomy() {
	const req = Readable.from([]);
	req.method = 'GET';
	req.url = '/api/play/economy';
	req.headers = { origin: 'http://localhost:3000' };
	const res = mockRes();
	await handler(req, res);
	expect(res.statusCode).toBe(200);
	return res.json;
}

function roomAt(at, profile) {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', {
		value: { players: new Map([['s1', { x: at.x, z: at.z }]]) },
		writable: true,
		configurable: true,
	});
	room.econ = new Map([['s1', profile]]);
	room._actionCounters = new Map();
	room._persistEcon = vi.fn();
	room._sendInv = vi.fn();
	room._sendProfile = vi.fn();
	room._actionOk = () => true;
	const sent = [];
	const client = { sessionId: 's1', send: (type, msg) => sent.push({ type, msg }) };
	return { room, client, sent };
}

describe('general store: published prices equal what the server charges', () => {
	it('every buy entry is charged exactly its published price and delivers its published quantity', async () => {
		const econ = await readEconomy();
		expect(econ.generalStore.buy.length).toBeGreaterThan(0);
		for (const entry of econ.generalStore.buy) {
			const profile = newProfile('acct-truth-buy');
			profile.gold = 10_000;
			for (let i = 0; i < INV_SIZE; i++) profile.inv[i] = { item: '', qty: 0 };
			const { room, client } = roomAt(VENDOR_STALLS[0], profile);
			room._handleStoreBuy(client, { item: entry.item });
			const delivered = profile.inv.filter((s) => s.item === entry.item).reduce((n, s) => n + s.qty, 0);
			expect(10_000 - profile.gold, `${entry.item} charge`).toBe(entry.price);
			expect(delivered, `${entry.item} quantity`).toBe(entry.qty);
		}
	});

	it('every sell entry is paid exactly its published price per unit', async () => {
		const econ = await readEconomy();
		expect(econ.generalStore.sell.length).toBeGreaterThan(0);
		for (const entry of econ.generalStore.sell) {
			const profile = newProfile('acct-truth-sell');
			profile.gold = 0;
			profile.inv[0] = { item: entry.item, qty: 7 };
			const { room, client } = roomAt(VENDOR_STALLS[0], profile);
			room._handleStoreSell(client, { slot: { zone: 'inv', i: 0 } });
			expect(profile.gold, `${entry.item} payout`).toBe(entry.price * 7);
		}
	});

	it('the catalog the server sends the client store panel is the published one', async () => {
		const econ = await readEconomy();
		const { room, client, sent } = roomAt(VENDOR_STALLS[0], newProfile('acct-truth-cat'));
		room._sendStore(client);
		const wire = sent.find((m) => m.type === 'store').msg;
		expect(wire.sell.map((e) => [e.item, e.price])).toEqual(econ.generalStore.sell.map((e) => [e.item, e.price]));
		expect(wire.buy.map((e) => [e.item, e.qty, e.price])).toEqual(
			econ.generalStore.buy.map((e) => [e.item, e.qty, e.price]),
		);
	});
});

describe('boutique: published $THREE prices equal the server quote price', () => {
	it('every listing price is the whole-token price the quote handler prices from', async () => {
		const econ = await readEconomy();
		expect(econ.boutique.currency).toBe('$THREE');
		expect(econ.boutique.listings.length).toBeGreaterThan(0);
		for (const l of econ.boutique.listings) {
			expect(boutiquePrice(l.id), l.id).toBe(l.price);
			expect(l.price).toBeGreaterThan(0);
		}
	});
});

describe('wheel: published odds equal the table the wheel UI receives', () => {
	it('paytable odds sum to 100 and match the wedges sent to the client', async () => {
		const econ = await readEconomy();
		const total = econ.wheel.paytable.reduce((n, r) => n + r.oddsPct, 0);
		expect(total).toBeCloseTo(100, 6);
		expect(econ.wheel.wedges).toBe(WHEEL_SEGMENTS.length);

		const profile = newProfile('acct-truth-wheel');
		const { room, client, sent } = roomAt(WHEEL[0], profile);
		handleSpinInfo(room, client);
		const info = sent.find((m) => m.type === 'spinInfo').msg;
		expect(info.segments).toEqual(WHEEL_SEGMENTS);
		expect(info.costUsd).toBe(econ.wheel.paidSpinUsd);
		expect(info.minLevel).toBe(econ.wheel.minAvgLevel);
		expect(econ.wheel.paidSpinUsd).toBe(SPIN_COST_USD);
		expect(econ.wheel.minAvgLevel).toBe(MIN_AVG_LEVEL);
	});

	it('every prize row in the paytable has positive odds and an amount', async () => {
		const econ = await readEconomy();
		for (const r of econ.wheel.paytable) {
			expect(r.oddsPct).toBeGreaterThan(0);
			expect(r.kind === 'gold' ? r.gold : r.qty).toBeGreaterThan(0);
		}
	});

	it('the free-spin cadence the UI states is the real cooldown', async () => {
		const econ = await readEconomy();
		expect(econ.wheel.freeSpinCooldownMs).toBe(FREE_SPIN_COOLDOWN_MS);
		const ui = readFileSync(new URL('../src/game/spin-wheel-ui.js', import.meta.url), 'utf8');
		const stated = /1 per (\d+)h/.exec(ui);
		expect(stated, 'spin-wheel-ui.js states the free cadence').not.toBeNull();
		expect(Number(stated[1]) * 3_600_000).toBe(FREE_SPIN_COOLDOWN_MS);
	});
});

describe('progression constants', () => {
	it('match the economy module', async () => {
		const econ = await readEconomy();
		expect(econ.progression.inventorySlots).toBe(INV_SIZE);
		expect(econ.progression.hotbarSlots).toBe(HOTBAR_SIZE);
		expect(econ.progression.maxStack).toBe(MAX_STACK);
		expect(econ.progression.levelCap).toBe(LEVEL_CAP);
	});
});
