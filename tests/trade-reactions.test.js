import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachTradeReactions } from '../src/pump/trade-reactions.js';

// Minimal EventSource mock. close() prevents further _fire() calls (mirrors real behaviour).
class MockEventSource {
	constructor() {
		this._listeners = {};
		this.readyState = 1; // OPEN
		MockEventSource._last = this;
	}
	addEventListener(type, fn) {
		(this._listeners[type] ??= []).push(fn);
	}
	close() {
		this.readyState = 2; // CLOSED
	}
	_fire(type, data) {
		if (this.readyState === 2) return;
		const msg = { data: JSON.stringify(data) };
		for (const fn of (this._listeners[type] ?? [])) fn(msg);
	}
}
MockEventSource._last = null;

function makeAgent() {
	return { playEmote: vi.fn() };
}

/** Fire N buy trades of the given SOL amount through the mock EventSource. */
function seed(es, n, amount) {
	for (let i = 0; i < n; i++) {
		es._fire('trade', { solAmount: amount, txType: 'buy' });
	}
}

describe('attachTradeReactions', () => {
	beforeEach(() => {
		MockEventSource._last = null;
	});

	it('returns a detach function', () => {
		const detach = attachTradeReactions(makeAgent(), { mint: 'ABC', _EventSource: MockEventSource });
		expect(typeof detach).toBe('function');
		detach();
	});

	it('returns no-op when mint is missing', () => {
		const detach = attachTradeReactions(makeAgent(), { _EventSource: MockEventSource });
		expect(typeof detach).toBe('function');
		expect(MockEventSource._last).toBeNull(); // no EventSource created
		detach(); // should not throw
	});

	it('below-threshold trades do not trigger emotes', () => {
		const agent = makeAgent();
		attachTradeReactions(agent, { mint: 'ABC', _EventSource: MockEventSource });
		const es = MockEventSource._last;

		// 5 baseline trades to fill the rolling window
		seed(es, 5, 1.0);
		// 6th trade below the 90th-percentile threshold (1.0) — should not fire
		es._fire('trade', { solAmount: 0.5, txType: 'buy' });

		expect(agent.playEmote).not.toHaveBeenCalled();
	});

	it('above-threshold buy triggers cheer', () => {
		const agent = makeAgent();
		attachTradeReactions(agent, { mint: 'ABC', _EventSource: MockEventSource });
		const es = MockEventSource._last;

		seed(es, 5, 1.0); // baseline: threshold = 1.0
		es._fire('trade', { solAmount: 2.0, txType: 'buy' });

		expect(agent.playEmote).toHaveBeenCalledTimes(1);
		expect(agent.playEmote).toHaveBeenCalledWith('cheer', 1);
	});

	it('above-threshold sell triggers flinch', () => {
		const agent = makeAgent();
		attachTradeReactions(agent, { mint: 'ABC', _EventSource: MockEventSource });
		const es = MockEventSource._last;

		seed(es, 5, 1.0);
		es._fire('trade', { solAmount: 2.0, txType: 'sell' });

		expect(agent.playEmote).toHaveBeenCalledWith('flinch', 1);
	});

	it('graduation always triggers celebrate regardless of threshold', () => {
		const agent = makeAgent();
		attachTradeReactions(agent, { mint: 'ABC', _EventSource: MockEventSource });
		const es = MockEventSource._last;

		// No baseline trades — graduation should still fire
		es._fire('graduation', { mint: 'ABC', symbol: 'TEST' });

		expect(agent.playEmote).toHaveBeenCalledWith('celebrate', 1);
	});

	it('detach stops further triggers', () => {
		const agent = makeAgent();
		const detach = attachTradeReactions(agent, { mint: 'ABC', _EventSource: MockEventSource });
		const es = MockEventSource._last;

		seed(es, 5, 1.0); // fill window, no emotes yet

		detach(); // closes the EventSource

		// A trade that would normally trigger cheer is dropped after detach
		es._fire('trade', { solAmount: 2.0, txType: 'buy' });
		expect(agent.playEmote).not.toHaveBeenCalled();
	});

	it('respects intensity parameter', () => {
		const agent = makeAgent();
		attachTradeReactions(agent, { mint: 'ABC', intensity: 0.5, _EventSource: MockEventSource });
		const es = MockEventSource._last;

		seed(es, 5, 1.0);
		es._fire('trade', { solAmount: 2.0, txType: 'buy' });

		expect(agent.playEmote).toHaveBeenCalledWith('cheer', 0.5);
	});
});
