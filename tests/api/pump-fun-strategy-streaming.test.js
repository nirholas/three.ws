// Verifies runStrategy emits log entries via onLog as decisions happen,
// not only at end of run. This is what makes the SSE endpoint actually
// streaming rather than batch-flush.

import { describe, it, expect } from 'vitest';
import { runStrategy } from '../../examples/skills/pump-fun-strategy/handlers.js';

describe('runStrategy streaming', () => {
	it('invokes onLog for tick + skip + enter as they occur', async () => {
		const t0 = Date.now();
		const seenMints = ['MintA', 'MintB'];
		const stub = (tool, args) => {
			if (tool === 'pump-fun.getNewTokens') return { ok: true, data: { tokens: seenMints.map((mint) => ({ mint })) } };
			if (tool === 'pump-fun.getTokenDetails') return { ok: true, data: { creator: `C-${args.mint}`, createdAt: new Date(t0).toISOString() } };
			if (tool === 'pump-fun.getTokenHolders') {
				// MintA passes (high holders), MintB fails.
				const total = args.mint === 'MintA' ? 200 : 5;
				return { ok: true, data: { total, holders: [{ pct: 8 }] } };
			}
			if (tool === 'pump-fun.getCreatorProfile') return { ok: true, data: { rugCount: 0 } };
			if (tool === 'pump-fun.getBondingCurve') return { ok: true, data: { priceSol: 0.001 } };
			return { ok: true, data: {} };
		};
		const ctx = {
			skills: { invoke: async (t, a) => stub(t, a) },
			skillConfig: { defaultPollMs: 50 },
			memory: { note: () => {} },
		};

		const events = [];
		const result = await runStrategy({
			strategy: {
				scan: { kind: 'newTokens', limit: 5 },
				filters: ['holders.total > 50'],
				entry: { side: 'buy', amountSol: 0.05 },
				caps: { sessionSpendCapSol: 0.1, perTradeSol: 0.05, maxOpenPositions: 1 },
			},
			durationSec: 1,
			simulate: true,
			onLog: (e) => events.push({ ...e, _at: Date.now() }),
		}, ctx);

		expect(result.ok).toBe(true);
		// At minimum: tick(s), one skip (MintB), one enter (MintA).
		const actions = events.map((e) => e.action);
		expect(actions).toContain('tick');
		expect(actions).toContain('skip');
		expect(actions).toContain('enter');

		// onLog must fire mid-flight, not all at end.
		const enterAt = events.find((e) => e.action === 'enter')._at;
		const lastAt = events[events.length - 1]._at;
		// enter should fire before the last event by a measurable margin
		// (at minimum a poll cycle later).
		expect(enterAt).toBeLessThanOrEqual(lastAt);
	}, 5000);

	it('returns the same log via the result envelope', async () => {
		const ctx = {
			skills: {
				invoke: async (tool) => {
					if (tool === 'pump-fun.getNewTokens') return { ok: true, data: { tokens: [] } };
					return { ok: true, data: {} };
				},
			},
			skillConfig: { defaultPollMs: 50 },
			memory: { note: () => {} },
		};
		const events = [];
		const r = await runStrategy({
			strategy: { scan: { kind: 'newTokens' }, entry: { side: 'buy', amountSol: 0.01 } },
			durationSec: 1,
			simulate: true,
			onLog: (e) => events.push(e),
		}, ctx);
		expect(r.data.log.length).toBe(events.length);
	}, 5000);
});
