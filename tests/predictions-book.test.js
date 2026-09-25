// Order-book math for prediction markets (api/_lib/predictions/book.js),
// exercised against a book recorded from the live Solana venue
// (tests/fixtures/predictions/orderbook.json, re-record with
// scripts/predictions-record-fixtures.mjs).
//
// The properties that keep an agent's money safe are the ones pinned here: a
// buy never spends more than its stake and never pays above its max price, a
// sell never accepts below its min price, and the asks for one side are the
// other side's bids mirrored (a YES contract at p is a NO contract at 1 - p).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeOrderbook } from '../api/_lib/predictions/solana-venue.js';
import { asksFor, bidsFor, estimateBuy, estimateSell, depthUsd, summarizeBook } from '../api/_lib/predictions/book.js';

const raw = JSON.parse(readFileSync(new URL('./fixtures/predictions/orderbook.json', import.meta.url), 'utf8'));
const book = normalizeOrderbook(raw);

describe('normalizeOrderbook on a recorded venue book', () => {
	it('keeps only tradable levels, as probabilities, richest first, one row per price', () => {
		for (const side of ['yes_bids', 'no_bids']) {
			const levels = book[side];
			expect(levels.length).toBeGreaterThan(0);
			const prices = levels.map(([p]) => p);
			expect(new Set(prices).size).toBe(prices.length);
			for (let i = 0; i < levels.length; i++) {
				const [p, q] = levels[i];
				expect(p).toBeGreaterThan(0);
				expect(p).toBeLessThan(1);
				expect(q).toBeGreaterThan(0);
				if (i) expect(p).toBeLessThan(levels[i - 1][0]);
			}
		}
	});

	it('drops zero-cent and hundred-cent rows the venue publishes', () => {
		const zeroRows = (raw.yes || []).filter(([c]) => Number(c) <= 0).length;
		expect(zeroRows).toBeGreaterThan(0);
		expect(book.yes_bids.every(([p]) => p >= 0.01)).toBe(true);
	});

	it('aggregates contracts per level without losing any', () => {
		const total = (raw.no || []).filter(([c, q]) => c > 0 && c < 100 && q > 0).reduce((s, [, q]) => s + Number(q), 0);
		const kept = book.no_bids.reduce((s, [, q]) => s + q, 0);
		expect(kept).toBeCloseTo(total, 0);
	});

	it('treats an empty or malformed book as empty', () => {
		expect(normalizeOrderbook(null)).toEqual({ yes_bids: [], no_bids: [] });
		expect(normalizeOrderbook({ yes: [['x', 1], [50, -1]], no: 'nope' })).toEqual({ yes_bids: [], no_bids: [] });
	});
});

describe('asks and bids', () => {
	it('mirrors the opposite side into asks, cheapest first', () => {
		const asks = asksFor(book, 'yes');
		expect(asks[0][0]).toBeCloseTo(1 - book.no_bids[0][0], 4);
		for (let i = 1; i < asks.length; i++) expect(asks[i][0]).toBeGreaterThanOrEqual(asks[i - 1][0]);
	});

	it('the best YES ask sits at or above the best YES bid on a live book', () => {
		expect(asksFor(book, 'yes')[0][0]).toBeGreaterThanOrEqual(bidsFor(book, 'yes')[0][0]);
		expect(asksFor(book, 'no')[0][0]).toBeGreaterThanOrEqual(bidsFor(book, 'no')[0][0]);
	});
});

describe('estimateBuy', () => {
	const asks = asksFor(book, 'yes');
	const best = asks[0][0];

	it('fills a small stake at the best ask with no slippage', () => {
		const est = estimateBuy(asks, 5, 0.99);
		expect(est.filled_fully).toBe(true);
		expect(est.spent_usd).toBeCloseTo(5, 4);
		expect(est.avg_price).toBeCloseTo(best, 4);
		expect(est.slippage_bps).toBe(0);
		expect(est.contracts).toBeCloseTo(5 / best, 2);
		expect(est.payout_usd).toBe(est.contracts);
	});

	it('never spends more than the stake and never pays above the max price', () => {
		for (const stake of [1, 50, 5_000, 250_000]) {
			for (const max of [best, best + 0.01, best + 0.05, 0.99]) {
				const est = estimateBuy(asks, stake, max);
				expect(est.spent_usd).toBeLessThanOrEqual(stake + 1e-6);
				if (est.worst_price != null) expect(est.worst_price).toBeLessThanOrEqual(max + 1e-9);
				if (est.avg_price != null) expect(est.avg_price).toBeGreaterThanOrEqual(best - 1e-9);
				expect(est.spent_usd + est.unfilled_usd).toBeCloseTo(stake, 3);
			}
		}
	});

	it('leaves the stake unfilled when the limit is under the best ask', () => {
		const est = estimateBuy(asks, 10, best - 0.01);
		expect(est.contracts).toBe(0);
		expect(est.filled_fully).toBe(false);
		expect(est.unfilled_usd).toBe(10);
		expect(est.avg_price).toBeNull();
	});
});

describe('estimateSell', () => {
	const bids = bidsFor(book, 'yes');
	const best = bids[0][0];

	it('sells a small clip at the best bid', () => {
		const est = estimateSell(bids, 10, 0.01);
		expect(est.filled_fully).toBe(true);
		expect(est.avg_price).toBeCloseTo(best, 4);
		expect(est.proceeds_usd).toBeCloseTo(10 * best, 4);
	});

	it('never accepts a level under the min price', () => {
		const est = estimateSell(bids, 10_000_000, best);
		if (est.worst_price != null) expect(est.worst_price).toBeGreaterThanOrEqual(best - 1e-9);
		expect(est.contracts_sold + est.unfilled_contracts).toBeCloseTo(10_000_000, 2);
	});
});

describe('summarizeBook', () => {
	it('reports best prices, spread and depth for both sides', () => {
		const s = summarizeBook(book);
		expect(s.yes.best_ask).toBe(asksFor(book, 'yes')[0][0]);
		expect(s.yes.best_bid).toBe(bidsFor(book, 'yes')[0][0]);
		expect(s.spread).toBeGreaterThanOrEqual(0);
		expect(s.liquidity_usd).toBeCloseTo(s.yes.ask_depth_usd + s.yes.bid_depth_usd, 2);
		expect(s.yes.levels.asks.length).toBeLessThanOrEqual(8);
		expect(depthUsd([])).toBe(0);
	});
});
