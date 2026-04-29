import { describe, it, expect } from 'vitest';
import {
	runStrategy,
	closeAllPositions,
} from '../../examples/skills/pump-fun-strategy/handlers.js';

function passingMintCtx() {
	const t0 = Date.now();
	return {
		skills: {
			invoke: async (tool, args) => {
				if (tool === 'pump-fun.getNewTokens') return { ok: true, data: { tokens: [{ mint: 'GoodMint' }] } };
				if (tool === 'pump-fun.getTokenDetails') return { ok: true, data: { creator: 'C', createdAt: new Date(t0).toISOString() } };
				if (tool === 'pump-fun.getTokenHolders') return { ok: true, data: { total: 200, holders: [{ pct: 8 }] } };
				if (tool === 'pump-fun.getCreatorProfile') return { ok: true, data: { rugCount: 0 } };
				if (tool === 'pump-fun.getBondingCurve') return { ok: true, data: { priceSol: 0.001 } };
				if (tool === 'pump-fun-trade.buyToken') return { ok: true, data: { sig: 'REAL_SIG_' + args.mint } };
				return { ok: true, data: {} };
			},
		},
		skillConfig: { defaultPollMs: 50 },
		memory: { note: () => {} },
	};
}

describe('runStrategy policyGuard', () => {
	const baseStrategy = {
		scan: { kind: 'newTokens', limit: 5 },
		filters: ['holders.total > 50'],
		entry: { side: 'buy', amountSol: 0.05 },
		caps: { sessionSpendCapSol: 0.5, perTradeSol: 0.05, maxOpenPositions: 5 },
	};

	it('blocks buys when policyGuard returns a reason; emits policy-block', async () => {
		const events = [];
		const r = await runStrategy({
			strategy: baseStrategy,
			durationSec: 1,
			simulate: false,                                 // live path
			onLog: (e) => events.push(e),
			policyGuard: async () => ({ code: 'daily_cap_exceeded', msg: 'cap is 0.1, would spend 0.6' }),
		}, passingMintCtx());
		expect(r.ok).toBe(true);
		const blocks = events.filter((e) => e.action === 'policy-block');
		expect(blocks.length).toBeGreaterThanOrEqual(1);
		expect(blocks[0].code).toBe('daily_cap_exceeded');
		// No actual enters should have happened.
		expect(events.find((e) => e.action === 'enter')).toBeUndefined();
	}, 5000);

	it('skips policy check entirely in simulate mode', async () => {
		const events = [];
		let guardCalled = 0;
		const r = await runStrategy({
			strategy: baseStrategy,
			durationSec: 1,
			simulate: true,
			onLog: (e) => events.push(e),
			policyGuard: async () => { guardCalled++; return { code: 'x', msg: 'should not fire' }; },
		}, passingMintCtx());
		expect(r.ok).toBe(true);
		expect(guardCalled).toBe(0);
		expect(events.some((e) => e.action === 'enter')).toBe(true);
	}, 5000);

	it('respects abortSignal between iterations', async () => {
		const ctrl = new AbortController();
		const events = [];
		const start = Date.now();
		setTimeout(() => ctrl.abort(), 120);
		const r = await runStrategy({
			strategy: baseStrategy,
			durationSec: 5,                                  // would normally run 5s
			simulate: true,
			onLog: (e) => events.push(e),
			abortSignal: ctrl.signal,
		}, passingMintCtx());
		const elapsed = Date.now() - start;
		expect(r.ok).toBe(true);
		expect(elapsed).toBeLessThan(2000);                  // aborted well before deadline
		expect(events.some((e) => e.action === 'aborted')).toBe(true);
	}, 6000);
});

describe('closeAllPositions', () => {
	it('sells every SPL holding from solana-wallet.getSplBalances', async () => {
		const sells = [];
		const ctx = {
			wallet: { publicKey: { toBase58: () => 'WALLET' } },
			skills: {
				invoke: async (tool, args) => {
					if (tool === 'solana-wallet.getSplBalances') {
						return { ok: true, data: { balances: [
							{ mint: 'M1', amount: 100, decimals: 6 },
							{ mint: 'M2', amount: 5, decimals: 9 },
							{ mint: 'M3', amount: 0, decimals: 6 },                  // filtered
						] } };
					}
					if (tool === 'pump-fun-trade.sellToken') {
						sells.push(args);
						return { ok: true, data: { sig: 'SIG_' + args.mint } };
					}
					return { ok: true, data: {} };
				},
			},
			memory: { note: () => {} },
		};
		const r = await closeAllPositions({}, ctx);
		expect(r.ok).toBe(true);
		expect(r.data.sold).toBe(2);
		expect(r.data.errors).toBe(0);
		expect(sells.map((s) => s.mint).sort()).toEqual(['M1', 'M2']);
		expect(sells.every((s) => s.percent === 100)).toBe(true);
	});

	it('honours an explicit mints list and skips wallet enumeration', async () => {
		let enumCalled = 0;
		const ctx = {
			wallet: { publicKey: { toBase58: () => 'W' } },
			skills: {
				invoke: async (tool) => {
					if (tool === 'solana-wallet.getSplBalances') { enumCalled++; return { ok: true, data: { balances: [] } }; }
					if (tool === 'pump-fun-trade.sellToken') return { ok: true, data: { sig: 'X' } };
					return { ok: true, data: {} };
				},
			},
			memory: { note: () => {} },
		};
		const r = await closeAllPositions({ mints: ['Ma', 'Mb'] }, ctx);
		expect(r.ok).toBe(true);
		expect(r.data.total).toBe(2);
		expect(enumCalled).toBe(0);
	});

	it('reports per-mint errors without aborting the rest', async () => {
		const ctx = {
			wallet: { publicKey: { toBase58: () => 'W' } },
			skills: {
				invoke: async (tool, args) => {
					if (tool === 'pump-fun-trade.sellToken') {
						if (args.mint === 'BAD') return { ok: false, error: 'rpc 503' };
						return { ok: true, data: { sig: 'OK' } };
					}
					return { ok: true, data: {} };
				},
			},
			memory: { note: () => {} },
		};
		const r = await closeAllPositions({ mints: ['BAD', 'OK1', 'OK2'] }, ctx);
		expect(r.data.total).toBe(3);
		expect(r.data.sold).toBe(2);
		expect(r.data.errors).toBe(1);
		expect(r.data.log.find((l) => l.mint === 'BAD').error).toMatch(/rpc/);
	});

	it('simulate:true skips signing but reports targets', async () => {
		const ctx = {
			skills: { invoke: async () => ({ ok: true, data: {} }) },
			memory: { note: () => {} },
		};
		const r = await closeAllPositions({ mints: ['M1', 'M2'], simulate: true }, ctx);
		expect(r.ok).toBe(true);
		expect(r.data.sold).toBe(2);
		expect(r.data.simulate).toBe(true);
	});
});
