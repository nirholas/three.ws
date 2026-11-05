// src/shared/liquidate.js is the core behind every "Sell all" button: it decides
// which coins to sell and through which endpoint, then sells them one by one.
// The planner is pure; the runner takes an injected sellOne + sleep, so these
// tests drive it with no network and no timers.

import { describe, it, expect, vi } from 'vitest';
import {
	planLiquidation, runLiquidation, summarizeLiquidation, retryAfterSeconds, WSOL_MINT,
} from '../src/shared/liquidate.js';

// Clearly synthetic mints (base58-shaped, not real coins).
const A = 'THREEsynthetic1111111111111111111111111111A';
const B = 'THREEsynthetic1111111111111111111111111111B';
const C = 'THREEsynthetic1111111111111111111111111111C';
const D = 'THREEsynthetic1111111111111111111111111111D';
const USDC = 'THREEsyntheticUSDC1111111111111111111111111';

describe('planLiquidation', () => {
	it('sells every real token balance and skips USDC, wrapped SOL and empty accounts', () => {
		const items = planLiquidation({
			holdings: [
				{ mint: A, amount_raw: '5000000', decimals: 6, ui_amount: 5 },
				{ mint: USDC, amount_raw: '1000000', decimals: 6, ui_amount: 1, is_usdc: true },
				{ mint: WSOL_MINT, amount_raw: '100', decimals: 9, ui_amount: 0.0000001 },
				{ mint: B, amount_raw: '0', decimals: 6, ui_amount: 0 },
			],
		});
		expect(items.map((i) => i.mint)).toEqual([A]);
		expect(items[0]).toMatchObject({ route: 'wallet', amountRaw: '5000000', selected: true, state: 'queued' });
	});

	it('routes a coin the sniper holds open through the sniper close path', () => {
		const items = planLiquidation({
			holdings: [{ mint: A, amount_raw: '7', decimals: 6 }],
			sniperPositions: [{ id: 'pos-a', mint: A, status: 'open', base_amount: '7' }],
		});
		expect(items[0]).toMatchObject({ route: 'sniper', positionId: 'pos-a', busy: false, selected: true });
	});

	it('leaves a coin alone while the sniper is mid-buy or mid-sell on it', () => {
		const items = planLiquidation({
			holdings: [
				{ mint: A, amount_raw: '7', decimals: 6 },
				{ mint: B, amount_raw: '9', decimals: 6 },
			],
			sniperPositions: [
				{ id: 'pos-a', mint: A, status: 'closing' },
				{ id: 'pos-b', mint: B, status: 'opening' },
			],
		});
		const byMint = Object.fromEntries(items.map((i) => [i.mint, i]));
		expect(byMint[A]).toMatchObject({ busy: true, selected: false, state: 'busy', route: 'wallet' });
		expect(byMint[A].busyReason).toMatch(/already selling/);
		expect(byMint[B].busyReason).toMatch(/still buying/);
	});

	it('still plans an open sniper position the balance read missed', () => {
		const items = planLiquidation({
			holdings: [],
			sniperPositions: [
				{ id: 'pos-c', mint: C, status: 'open', base_amount: '1234', symbol: 'SYN' },
				{ id: 'pos-d', mint: D, status: 'open', base_amount: '0' },
			],
		});
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ mint: C, route: 'sniper', positionId: 'pos-c', amountRaw: '1234', symbol: 'SYN' });
	});

	it('orders by live value when known and carries display metadata', () => {
		const items = planLiquidation({
			holdings: [
				{ mint: A, amount_raw: '1', decimals: 0, ui_amount: 1 },
				{ mint: B, amount_raw: '1', decimals: 0, ui_amount: 1 },
			],
			meta: { B: undefined, [B]: { symbol: 'BEE', name: 'Bee', usd_value: 12 }, [A]: { usd_value: 3 } },
		});
		expect(items.map((i) => i.mint)).toEqual([B, A]);
		expect(items[0]).toMatchObject({ symbol: 'BEE', name: 'Bee', usdValue: 12 });
	});
});

describe('runLiquidation', () => {
	const plan = () => planLiquidation({
		holdings: [
			{ mint: A, amount_raw: '1', decimals: 6 },
			{ mint: B, amount_raw: '2', decimals: 6 },
			{ mint: C, amount_raw: '3', decimals: 6 },
		],
	});

	it('sells each selected coin in plan order (largest first) and totals the SOL received', async () => {
		const items = plan();
		items.find((i) => i.mint === B).selected = false;
		const sold = [];
		const summary = await runLiquidation({
			items,
			sellOne: async (it) => { sold.push(it.mint); return { solOut: 0.5, explorer: `https://x/${it.mint}` }; },
		});
		expect(sold).toEqual([C, A]);
		expect(summary).toMatchObject({ sold: 2, failed: 0, solOut: 1 });
		expect(items.find((i) => i.mint === B).state).toBe('queued');
	});

	it('records a failure on its row and keeps going', async () => {
		const items = plan();
		const summary = await runLiquidation({
			items,
			sellOne: async (it) => {
				if (it.mint === B) throw Object.assign(new Error('Price impact is 40%'), { code: 'price_impact_too_high' });
				return { solOut: 1 };
			},
		});
		const b = items.find((i) => i.mint === B);
		expect(b).toMatchObject({ state: 'failed', errorCode: 'price_impact_too_high', error: 'Price impact is 40%' });
		expect(summary).toMatchObject({ sold: 2, failed: 1, solOut: 2 });
	});

	it('waits out a rate limit and retries the same coin instead of failing it', async () => {
		const items = plan();
		let calls = 0;
		const sleep = vi.fn(async () => {});
		const states = [];
		await runLiquidation({
			items: items.slice(0, 1),
			sleep,
			onUpdate: (it) => states.push(it.state),
			sellOne: async () => {
				calls += 1;
				if (calls === 1) throw Object.assign(new Error('too many requests'), { code: 'rate_limited', detail: { retry_after: 7 } });
				return { solOut: 0.1 };
			},
		});
		expect(sleep).toHaveBeenCalledWith(7000, undefined);
		expect(states).toEqual(['selling', 'waiting', 'selling', 'sold']);
		expect(items[0].state).toBe('sold');
	});

	it('gives up on a coin after repeated rate limits', async () => {
		const items = plan().slice(0, 1);
		await runLiquidation({
			items,
			maxRateRetries: 2,
			sleep: async () => {},
			sellOne: async () => { throw Object.assign(new Error('too many requests'), { code: 'rate_limited' }); },
		});
		expect(items[0]).toMatchObject({ state: 'failed', errorCode: 'rate_limited' });
	});

	it('Stop lets the current sell finish and skips the rest', async () => {
		const items = plan();
		const ctl = new AbortController();
		const summary = await runLiquidation({
			items,
			signal: ctl.signal,
			sellOne: async () => { ctl.abort(); return { solOut: 0.2 }; },
		});
		expect(items.map((i) => i.state)).toEqual(['sold', 'skipped', 'skipped']);
		expect(summary).toMatchObject({ sold: 1, skipped: 2 });
	});

	it('never sells a busy coin, even if it was somehow selected', async () => {
		const items = planLiquidation({
			holdings: [{ mint: A, amount_raw: '1', decimals: 6 }],
			sniperPositions: [{ id: 'p', mint: A, status: 'closing' }],
		});
		items[0].selected = true;
		const sellOne = vi.fn();
		await runLiquidation({ items, sellOne });
		expect(sellOne).not.toHaveBeenCalled();
	});
});

describe('helpers', () => {
	it('reads retry-after from any of the shapes the clients throw', () => {
		expect(retryAfterSeconds({ retryAfter: 3 })).toBe(3);
		expect(retryAfterSeconds({ detail: { retry_after: '12' } })).toBe(12);
		expect(retryAfterSeconds({ retry_after: 999 })).toBe(120);
		expect(retryAfterSeconds({})).toBe(10);
	});

	it('summarizes with no known proceeds as null, not zero', () => {
		expect(summarizeLiquidation([{ state: 'sold', solOut: null }])).toMatchObject({ sold: 1, solOut: null });
	});
});
