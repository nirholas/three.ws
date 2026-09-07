// Unit tests for the Hood Desk derivations (api/_lib/robinhood-desk.js).
//
// These are the rules the desk renders: how a premium distribution is binned,
// which dislocations count as tradeable, how Blockscout's two balance feeds
// become one curve, and how a raw transaction/transfer pair becomes one line on
// the tape. Every fixture below is shaped like the real upstream payload (field
// names and raw atomic strings included), because the bugs these guard against
// were all shape bugs.

import { describe, it, expect } from 'vitest';
import {
	normalizeAddress,
	toUnits,
	premiumRidge,
	arbLeaders,
	balanceSeries,
	mergeBalanceHistory,
	seriesChange,
	classifyTransaction,
	classifyTransfer,
	mergeActivity,
	counterpartyFlow,
	rollupBook,
} from '../api/_lib/robinhood-desk.js';

// Synthetic addresses: these tests pin arithmetic and shape, never a real wallet.
const ME = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x2222222222222222222222222222222222222222';

describe('normalizeAddress', () => {
	it('lowercases a checksummed address and rejects everything else', () => {
		expect(normalizeAddress('0xAbCdEf0000000000000000000000000000000001')).toBe(
			'0xabcdef0000000000000000000000000000000001',
		);
		expect(normalizeAddress('0x123')).toBeNull();
		expect(normalizeAddress('not an address')).toBeNull();
		expect(normalizeAddress(null)).toBeNull();
	});
});

describe('toUnits', () => {
	it('divides a raw atomic string by its decimals', () => {
		expect(toUnits('5000000000000000000', 18)).toBe(5);
		expect(toUnits('1500000', 6)).toBe(1.5);
	});

	it('returns null rather than a wrong number when decimals are unknown', () => {
		// An unverified launchpad token is indexed with decimals: null. Guessing
		// 18 would print a balance off by orders of magnitude.
		expect(toUnits('5000000000000000000', null)).toBeNull();
		expect(toUnits(null, 18)).toBeNull();
		expect(toUnits('abc', 18)).toBeNull();
	});
});

describe('premiumRidge', () => {
	const rows = [
		{ symbol: 'MU', premiumPct: 2.5, liquidityUsd: 1_600_000 },
		{ symbol: 'AMD', premiumPct: 1.4, liquidityUsd: 730_000 },
		{ symbol: 'SPCX', premiumPct: 1.7, liquidityUsd: 2_500_000 },
		{ symbol: 'NVDA', premiumPct: -0.3, liquidityUsd: 900_000 },
		{ symbol: 'NOPOOL', premiumPct: null, liquidityUsd: null },
	];

	it('bins only the tokens priced on both sides', () => {
		const ridge = premiumRidge(rows);
		expect(ridge.stats.priced).toBe(4);
		expect(ridge.stats.total).toBe(5);
		const front = ridge.layers[0];
		expect(front.count).toBe(4);
		expect(front.density.reduce((a, b) => a + b, 0)).toBe(4);
	});

	it('fits the axis to the day dispersion instead of a fixed span', () => {
		const tight = premiumRidge([{ symbol: 'A', premiumPct: 0.2, liquidityUsd: 1 }]);
		expect(tight.stats.spanPct).toBe(1);
		const wide = premiumRidge([{ symbol: 'A', premiumPct: 6, liquidityUsd: 1 }]);
		expect(wide.stats.spanPct).toBeGreaterThanOrEqual(6);
	});

	it('thins each deeper liquidity layer, so the ridge reads as depth', () => {
		const ridge = premiumRidge(rows);
		const counts = ridge.layers.map((l) => l.count);
		expect(counts[0]).toBe(4);
		for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
	});

	it('clamps an outlier into the edge bin instead of flattening the chart', () => {
		const ridge = premiumRidge([...rows, { symbol: 'BROKEN', premiumPct: 900, liquidityUsd: 10 }], { span: 4 });
		expect(ridge.layers[0].density[ridge.bins.length - 1]).toBe(1);
		expect(ridge.stats.spanPct).toBe(4);
	});

	it('survives an empty board', () => {
		const ridge = premiumRidge([]);
		expect(ridge.stats.priced).toBe(0);
		expect(ridge.stats.median).toBeNull();
		expect(ridge.layers.every((l) => l.count === 0)).toBe(true);
	});
});

describe('arbLeaders', () => {
	it('ranks by absolute dislocation and drops pools too thin to trade', () => {
		const leaders = arbLeaders([
			{ symbol: 'DEEP', premiumPct: 1.2, liquidityUsd: 500_000 },
			{ symbol: 'DUST', premiumPct: 40, liquidityUsd: 12 },
			{ symbol: 'CHEAP', premiumPct: -3.4, liquidityUsd: 90_000 },
			{ symbol: 'NOPOOL', premiumPct: 9, liquidityUsd: null },
		]);
		expect(leaders.map((r) => r.symbol)).toEqual(['CHEAP', 'DEEP']);
		expect(leaders[0].side).toBe('dex-cheap');
		expect(leaders[1].side).toBe('dex-rich');
	});
});

describe('balanceSeries', () => {
	const items = [
		{ block_number: 3, block_timestamp: '2026-09-07T20:58:42Z', value: '70710803028246028' },
		{ block_number: 2, block_timestamp: '2026-09-07T20:57:42Z', value: '84300058721425040' },
		{ block_number: 1, block_timestamp: '2026-09-07T20:56:42Z', value: '0' },
	];

	it('flips Blockscout newest-first into an ascending ETH curve', () => {
		const series = balanceSeries(items, { ethPriceUsd: 2000 });
		expect(series.map((p) => p.block)).toEqual([1, 2, 3]);
		expect(series[2].eth).toBeCloseTo(0.07071080302824603, 12);
		expect(series[2].usd).toBeCloseTo(0.07071080302824603 * 2000, 8);
	});

	it('leaves usd null when no ETH price is available', () => {
		expect(balanceSeries(items)[0].usd).toBeNull();
	});

	it('keeps the last balance when several transfers share one timestamp', () => {
		const series = balanceSeries([
			{ block_number: 2, block_timestamp: '2026-09-07T20:58:42Z', value: '2000000000000000000' },
			{ block_number: 1, block_timestamp: '2026-09-07T20:58:42Z', value: '1000000000000000000' },
		]);
		expect(series).toHaveLength(1);
		expect(series[0].eth).toBe(2);
	});

	it('drops unparseable points instead of rendering NaN', () => {
		expect(balanceSeries([{ block_timestamp: 'never', value: '1' }, { value: null }])).toEqual([]);
	});
});

describe('mergeBalanceHistory', () => {
	it('plots a daily close at the end of its day and stops where the tape starts', () => {
		const now = Date.parse('2026-09-07T21:00:00Z');
		const daily = balanceSeries([
			{ date: '2026-09-05', value: '1000000000000000000' },
			{ date: '2026-09-06', value: '2000000000000000000' },
			{ date: '2026-09-07', value: '3000000000000000000' },
		]);
		const intraday = balanceSeries([
			{ block_number: 9, block_timestamp: '2026-09-07T20:58:42Z', value: '3000000000000000000' },
		]);
		const merged = mergeBalanceHistory(daily, intraday, { now });
		// The 2026-09-07 daily close is dropped: the per-transaction feed already
		// covers that instant, and plotting both would draw a step backwards.
		expect(merged).toHaveLength(3);
		expect(new Date(merged[0].t).toISOString()).toBe('2026-09-05T23:59:59.000Z');
		expect(merged[merged.length - 1].block).toBe(9);
	});

	it('returns the daily curve alone when nothing intraday is indexed', () => {
		const daily = balanceSeries([{ date: '2026-09-06', value: '1000000000000000000' }]);
		expect(mergeBalanceHistory(daily, [], { now: Date.parse('2026-09-07T00:00:00Z') })).toHaveLength(1);
	});
});

describe('seriesChange', () => {
	it('reports start, end, delta and percentage', () => {
		const change = seriesChange([
			{ t: 1, eth: 2 },
			{ t: 2, eth: 3 },
		]);
		expect(change.deltaEth).toBe(1);
		expect(change.pct).toBeCloseTo(50, 6);
	});

	it('cannot divide by a zero opening balance', () => {
		const change = seriesChange([
			{ t: 1, eth: 0 },
			{ t: 2, eth: 5 },
		]);
		expect(change.deltaEth).toBe(5);
		expect(change.pct).toBeNull();
	});

	it('reports nulls for a one-point series rather than a fake flat line', () => {
		expect(seriesChange([{ t: 1, eth: 2 }]).deltaEth).toBeNull();
	});
});

describe('classifyTransaction', () => {
	it('reads a router call with token legs as a swap', () => {
		const ev = classifyTransaction(
			{
				hash: '0xabc',
				method: '0xd04c6983',
				result: 'success',
				value: '0',
				transaction_types: ['contract_call', 'token_transfer'],
				from: { hash: ME },
				to: { hash: ROUTER },
			},
			ME,
		);
		expect(ev.kind).toBe('swap');
		expect(ev.direction).toBe('out');
		expect(ev.counterparty).toBe(ROUTER);
	});

	it('separates a plain send from a plain receive', () => {
		const out = classifyTransaction({ hash: '0x1', value: '1000000000000000000', from: { hash: ME }, to: { hash: ROUTER } }, ME);
		const inn = classifyTransaction({ hash: '0x2', value: '1000000000000000000', from: { hash: ROUTER }, to: { hash: ME } }, ME);
		expect(out.kind).toBe('send');
		expect(inn.kind).toBe('receive');
		expect(inn.counterparty).toBe(ROUTER);
		expect(out.valueEth).toBe(1);
	});

	it('labels approvals and claims for what they are', () => {
		expect(classifyTransaction({ hash: '0x3', method: 'approve', from: { hash: ME }, to: { hash: ROUTER } }, ME).kind).toBe('approve');
		expect(classifyTransaction({ hash: '0x4', method: 'claimFree', from: { hash: ME }, to: { hash: ROUTER } }, ME).kind).toBe('claim');
	});
});

describe('classifyTransfer', () => {
	it('uses the transfer total decimals, not a guessed 18', () => {
		const ev = classifyTransfer(
			{
				transaction_hash: '0xabc',
				from: { hash: ROUTER },
				to: { hash: ME },
				token: { address_hash: '0xAAA0000000000000000000000000000000000001', symbol: 'USDG', decimals: 6 },
				total: { value: '2500000', decimals: 6 },
			},
			ME,
		);
		expect(ev.amount).toBe(2.5);
		expect(ev.direction).toBe('in');
		expect(ev.kind).toBe('receive');
	});

	it('calls a transfer out of the zero address a mint', () => {
		const ev = classifyTransfer(
			{
				transaction_hash: '0xd',
				from: { hash: '0x0000000000000000000000000000000000000000' },
				to: { hash: ME },
				token: { address_hash: '0xAAA0000000000000000000000000000000000002', symbol: 'NEW', decimals: 18 },
				total: { value: '1000000000000000000', decimals: 18 },
			},
			ME,
		);
		expect(ev.kind).toBe('mint');
	});
});

describe('mergeActivity', () => {
	const tx = {
		hash: '0xswap',
		method: 'swapExactETHForTokens',
		result: 'success',
		value: '50000000000000000',
		timestamp: '2026-09-07T20:58:40Z',
		transaction_types: ['contract_call', 'token_transfer'],
		from: { hash: ME },
		to: { hash: ROUTER },
	};
	const transfer = {
		transaction_hash: '0xswap',
		timestamp: '2026-09-07T20:58:40Z',
		from: { hash: ROUTER },
		to: { hash: ME },
		token: { address_hash: '0xAAA0000000000000000000000000000000000003', symbol: 'MEME', decimals: 18 },
		total: { value: '27000000000000000000', decimals: 18 },
	};

	it('folds a swap transfer onto its transaction instead of printing it twice', () => {
		const tape = mergeActivity([tx], [transfer], ME);
		expect(tape).toHaveLength(1);
		expect(tape[0].kind).toBe('swap');
		expect(tape[0].tokens).toEqual([
			{ symbol: 'MEME', address: '0xaaa0000000000000000000000000000000000003', amount: 27, direction: 'in' },
		]);
	});

	it('keeps a transfer whose transaction is outside the fetched window', () => {
		const tape = mergeActivity([], [transfer], ME);
		expect(tape).toHaveLength(1);
		expect(tape[0].kind).toBe('receive');
	});

	it('orders the tape newest first and caps it', () => {
		const older = { ...tx, hash: '0xold', timestamp: '2026-09-07T19:00:00Z' };
		const tape = mergeActivity([older, tx], [], ME, { limit: 1 });
		expect(tape).toHaveLength(1);
		expect(tape[0].hash).toBe('0xswap');
	});
});

describe('counterpartyFlow', () => {
	it('ranks counterparties by legs crossed and splits direction', () => {
		const rows = counterpartyFlow([
			{ counterparty: ROUTER, direction: 'out', kind: 'swap' },
			{ counterparty: ROUTER, direction: 'out', kind: 'swap' },
			{ counterparty: ROUTER, direction: 'in', kind: 'receive' },
			{ counterparty: '0xAAA0000000000000000000000000000000000004', direction: 'in', kind: 'receive' },
			{ counterparty: '0x0000000000000000000000000000000000000000', direction: 'in', kind: 'mint' },
			{ counterparty: null, direction: 'in', kind: 'call' },
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].address).toBe(ROUTER);
		expect(rows[0].outCount).toBe(2);
		expect(rows[0].inCount).toBe(1);
		expect(rows[0].kinds).toEqual({ swap: 2, receive: 1 });
	});
});

describe('rollupBook', () => {
	it('totals native plus priced tokens and shares out the book', () => {
		const book = rollupBook(100, [
			{ symbol: 'A', valueUsd: 60 },
			{ symbol: 'B', valueUsd: 40 },
		]);
		expect(book.bookValueUsd).toBe(200);
		expect(book.positions[0].sharePct).toBeCloseTo(30, 6);
		expect(book.nativeSharePct).toBeCloseTo(50, 6);
	});

	it('never counts an unpriced token into the book as zero-value truth', () => {
		const book = rollupBook(100, [{ symbol: 'UNKNOWN', valueUsd: null }]);
		expect(book.bookValueUsd).toBe(100);
		expect(book.positionCount).toBe(1);
		expect(book.pricedCount).toBe(0);
		expect(book.positions[0].sharePct).toBeNull();
	});
});
