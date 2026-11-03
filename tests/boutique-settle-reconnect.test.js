// A $THREE boutique purchase is final on-chain before the world is asked to
// grant the item. Meetup #3 client audit (failure states): if the room socket
// was down at that moment, net.boutiqueSettle() was silently dropped, the
// buyer waited 20 s for a notice that could never come, and the settle was
// never sent again, even though the server accepts it for the life of the quote.
//
// The net here is a small in-memory stand-in for CommunityNet's event surface
// (on / boutiqueSettle / isLive); the logic under test is the real module.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { settleBoutique } from '../src/game/boutique-purchase.js';
import { CommunityNet } from '../src/game/community-net.js';

const SIG = '5TxSynthetic1111111111111111111111111111111111111111111111111111111111111111111111';

function makeNet({ live = true } = {}) {
	const handlers = new Map();
	const net = {
		live,
		sent: [],
		on(event, fn) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(fn);
			return () => handlers.get(event)?.delete(fn);
		},
		emit(event, ...args) { for (const fn of [...(handlers.get(event) || [])]) fn(...args); },
		isLive() { return this.live; },
		boutiqueSettle(quoteToken, txSig) {
			if (!this.live) return false;
			this.sent.push({ quoteToken, txSig });
			return true;
		},
	};
	return net;
}

afterEach(() => { vi.useRealTimers(); });

describe('CommunityNet send wrappers report delivery', () => {
	it('returns false when no room socket is open, so callers can react', () => {
		const net = new CommunityNet({ name: 'tester' });
		expect(net.boutiqueSettle('q', SIG)).toBe(false);
		expect(net.sendChat('hello')).toBe(false);
		expect(net.spinPaidSettle({}, SIG)).toBe(false);
		expect(net.questAccept('q1')).toBe(false);
	});

	it('returns true once the message reaches an open socket', () => {
		const net = new CommunityNet({ name: 'tester' });
		const sent = [];
		net.room = { connection: { isOpen: true }, send: (type, payload) => sent.push([type, payload]) };
		expect(net.sendChat('hello')).toBe(true);
		expect(sent).toEqual([['chat', { text: 'hello' }]]);
	});
});

describe('settleBoutique', () => {
	it('settles straight through when the socket is up', async () => {
		const net = makeNet();
		const p = settleBoutique(net, 'quote-1', SIG, { deadlineAt: Date.now() + 60000 });
		expect(net.sent).toHaveLength(1);
		net.emit('notice', { kind: 'boutique', ok: true, text: 'Unlocked Halo, check your wardrobe.' });
		await expect(p).resolves.toMatchObject({ text: 'Unlocked Halo, check your wardrobe.' });
	});

	it('waits for the reconnect and resends a settle the dropped socket swallowed', async () => {
		const net = makeNet({ live: false });
		const stages = [];
		const p = settleBoutique(net, 'quote-1', SIG, { deadlineAt: Date.now() + 60000, onStage: (s) => stages.push(s) });
		await Promise.resolve();
		expect(net.sent).toHaveLength(0);
		expect(stages).toContain('reconnecting');

		net.live = true;
		net.emit('status', { status: 'online' });
		await Promise.resolve();
		expect(net.sent).toEqual([{ quoteToken: 'quote-1', txSig: SIG }]);
		net.emit('notice', { kind: 'boutique', ok: true, text: 'Unlocked Halo, check your wardrobe.' });
		await expect(p).resolves.toMatchObject({ text: /Unlocked Halo/ });
	});

	it('treats "already settled" after a resend as the earlier settle having landed', async () => {
		vi.useFakeTimers();
		const net = makeNet();
		const p = settleBoutique(net, 'quote-1', SIG, { deadlineAt: Date.now() + 80000, noticeTimeoutMs: 15000 });
		// The first notice went to a session that dropped; nothing comes back.
		await vi.advanceTimersByTimeAsync(15001);
		expect(net.sent).toHaveLength(2);
		net.emit('notice', { kind: 'boutique', ok: false, text: 'That purchase already settled.' });
		await expect(p).resolves.toMatchObject({ ok: true });
	});

	it('still reports a genuine server rejection on the first send', async () => {
		const net = makeNet();
		const p = settleBoutique(net, 'quote-1', SIG, { deadlineAt: Date.now() + 60000 });
		net.emit('notice', { kind: 'boutique', ok: false, text: 'Payment didn’t verify (underpaid).' });
		await expect(p).rejects.toThrow(/underpaid/);
	});

	it('gives up at the quote deadline with the transaction id, never a bare timeout', async () => {
		vi.useFakeTimers();
		const net = makeNet({ live: false });
		const p = settleBoutique(net, 'quote-1', SIG, { deadlineAt: Date.now() + 30000 });
		const caught = p.catch((e) => e);
		await vi.advanceTimersByTimeAsync(30001);
		const err = await caught;
		expect(err.message).toMatch(/payment went through/i);
		expect(err.message).toContain(SIG.slice(0, 6));
		expect(err.sig).toBe(SIG);
	});
});
