// World chat scrollback (work order 727). In-world chat used to be a pure
// relay, so a late joiner arrived to an empty log. The room now keeps a capped,
// expiring tail per world and hands it to each arrival in one batched message.
// These tests pin the store contract: trim to the cap, TTL expiry, dedupe by
// message id (never by text), oldest-first ordering, privacy of what is kept,
// and that a trimmed line is gone for good.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	ChatScrollback,
	createMemoryStore,
	scrollbackKey,
	toScrollbackRecord,
	SCROLLBACK_CAP,
	SCROLLBACK_TTL_S,
	JOIN_TAIL,
} from '../multiplayer/src/chat-scrollback.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WORLD = scrollbackKey(THREE);

let clock;
let store;
let sb;
beforeEach(() => {
	clock = { now: 1_800_000_000_000 };
	store = createMemoryStore({ now: () => clock.now });
	sb = new ChatScrollback({ store, now: () => clock.now, cap: 5, ttlS: 60, tail: 4 });
});

const line = (text, extra = {}) => ({ name: 'nova', text, ...extra });

describe('scrollback key', () => {
	it('keys the General and Holders worlds of a coin separately, and the mainland by name', () => {
		expect(scrollbackKey(THREE)).toBe(`chat:scrollback:${THREE}`);
		expect(scrollbackKey(`${THREE}#holders`)).toBe(`chat:scrollback:${THREE}#holders`);
		expect(scrollbackKey('')).toBe('chat:scrollback:mainland');
	});

	it('states production values that keep a join payload small', () => {
		expect(SCROLLBACK_CAP).toBe(200);
		expect(SCROLLBACK_TTL_S).toBe(3 * 24 * 60 * 60);
		expect(JOIN_TAIL).toBeLessThanOrEqual(SCROLLBACK_CAP);
	});
});

describe('ChatScrollback', () => {
	it('returns the tail oldest first, capped at the join tail size', async () => {
		for (let i = 1; i <= 5; i++) { clock.now += 1000; await sb.append(WORLD, line(`m${i}`)); }
		const tail = await sb.tail(WORLD);
		expect(tail.map((r) => r.text)).toEqual(['m2', 'm3', 'm4', 'm5']);
		for (let i = 1; i < tail.length; i++) expect(tail[i].ts).toBeGreaterThan(tail[i - 1].ts);
	});

	it('trims to the cap on every write', async () => {
		for (let i = 1; i <= 8; i++) await sb.append(WORLD, line(`m${i}`));
		const kept = await store.range(WORLD, 100);
		expect(kept).toHaveLength(5);
		expect(kept.map((r) => r.text)).toEqual(['m8', 'm7', 'm6', 'm5', 'm4']);
	});

	it('drops lines older than the TTL even while the world stays busy', async () => {
		await sb.append(WORLD, line('old'));
		clock.now += 61_000;
		await sb.append(WORLD, line('fresh'));
		expect((await sb.tail(WORLD)).map((r) => r.text)).toEqual(['fresh']);
	});

	it('expires a quiet world entirely', async () => {
		await sb.append(WORLD, line('hello'));
		clock.now += 61_000;
		expect(await sb.tail(WORLD)).toEqual([]);
		expect(await store.range(WORLD, 100)).toEqual([]);
	});

	it('dedupes by message id, never by text', async () => {
		await sb.append(WORLD, line('gm'));
		await sb.append(WORLD, line('gm'));
		const first = (await sb.tail(WORLD))[0];
		await sb.append(WORLD, { ...line('gm'), mid: first.mid });
		const tail = await sb.tail(WORLD);
		expect(tail.map((r) => r.text)).toEqual(['gm', 'gm']);
		expect(new Set(tail.map((r) => r.mid)).size).toBe(2);
	});

	it('gives every line a stable id the live broadcast can carry', async () => {
		const rec = await sb.append(WORLD, line('first'));
		const [stored] = await sb.tail(WORLD);
		expect(rec.mid).toMatch(/^[a-z0-9-]{8,}$/);
		expect(stored.mid).toBe(rec.mid);
	});

	it('never throws when the store is down: no history, never a broken handler', async () => {
		const broken = {
			async push() { throw new Error('ECONNRESET'); },
			async range() { throw new Error('ECONNRESET'); },
		};
		const warn = vi.fn();
		const quiet = new ChatScrollback({ store: broken, now: () => clock.now, log: { warn } });
		await expect(quiet.append(WORLD, line('hi'))).resolves.toMatchObject({ text: 'hi' });
		await expect(quiet.tail(WORLD)).resolves.toEqual([]);
		expect(warn).toHaveBeenCalled();
	});

	it('is a no-op without a store, so a memory-only server simply has no scrollback', async () => {
		const none = new ChatScrollback({ store: null });
		await expect(none.append(WORLD, line('hi'))).resolves.toMatchObject({ text: 'hi' });
		await expect(none.tail(WORLD)).resolves.toEqual([]);
	});
});

describe('privacy of a stored line', () => {
	it('keeps only the display name, text, time and message id', () => {
		const rec = toScrollbackRecord(
			{ name: 'nova', text: 'gm', sessionId: 'sess_abc123', wallet: THREE, userId: 'u1', ip: '10.0.0.1' },
			{ now: () => 5 },
		);
		expect(Object.keys(rec).sort()).toEqual(['mid', 'name', 'text', 'ts']);
		expect(JSON.stringify(rec)).not.toContain('sess_abc123');
		expect(JSON.stringify(rec)).not.toContain(THREE);
	});

	it('shortens a display name that is a wallet address', () => {
		expect(toScrollbackRecord({ name: THREE, text: 'gm' }).name).toBe('FeMb…pump');
		expect(toScrollbackRecord({ name: '0x52908400098527886e0f7030069857d2e4169ee7', text: 'gm' }).name).toBe('0x5290…9ee7');
	});

	it('refuses a line that did not pass the slur gate', async () => {
		const rec = await sb.append(WORLD, line('you are a faggot'));
		expect(rec).toBeNull();
		expect(await sb.tail(WORLD)).toEqual([]);
	});

	it('refuses empty or non-string text', async () => {
		expect(await sb.append(WORLD, line('   '))).toBeNull();
		expect(await sb.append(WORLD, line(42))).toBeNull();
	});

	it('makes a trimmed line unrecoverable from the module', async () => {
		await sb.append(WORLD, line('secret first line'));
		for (let i = 0; i < 5; i++) await sb.append(WORLD, line(`filler ${i}`));
		expect(JSON.stringify(await store.range(WORLD, 1000))).not.toContain('secret first line');
		expect(store.dump()).not.toContain('secret first line');
		expect(JSON.stringify(await sb.tail(WORLD))).not.toContain('secret first line');
	});
});
