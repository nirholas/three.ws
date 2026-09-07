// Unit tests for the Robinhood Portfolios data layer (api/_lib/hood-portfolios.js).
//
// These cover the parts that decide whether a generated basket is safe to show
// somebody: that a model cannot smuggle a token past the universe, that weights
// always land on exactly 10000, that the manifest hash is stable under key
// reordering (it is committed on-chain, so two serialisations MUST agree), and
// that a basket with an unpriceable leg refuses to report a NAV rather than
// reporting a smaller one as if it were complete.
//
// The universe fixture is the real committed snapshot, not a hand-written one,
// so a change to its shape breaks these rather than passing silently.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
	ASSET_CLASSES,
	normaliseWeights,
	MAX_CONSTITUENTS,
	MAX_WEIGHT_BPS,
	MIN_CONSTITUENTS,
	buildManifest,
	canonicalise,
	manifestHash,
	universeSnapshot,
	validateScreen,
	valueBasket,
} from '../api/_lib/hood-portfolios.js';

const snapshot = JSON.parse(
	readFileSync(path.join(process.cwd(), 'data', 'hood-portfolios-universe.json'), 'utf8'),
);

/** A handful of real tokens from the real snapshot, shaped as the screen sees them. */
function realTokens(count = 8) {
	return snapshot.tokens
		.filter((t) => t.canonical !== false && t.priceUsd > 0)
		.slice(0, count)
		.map((t) => ({ ...t }));
}

describe('the committed universe', () => {
	it('is a non-trivial snapshot of chain 4663', () => {
		expect(snapshot.chainId).toBe(4663);
		expect(snapshot.tokens.length).toBeGreaterThan(100);
		expect(snapshot.generatedAtBlock).toBeGreaterThan(0);
	});

	it('classifies every token into a known asset class', () => {
		const unknown = snapshot.tokens.filter((t) => !ASSET_CLASSES.includes(t.assetClass));
		expect(unknown).toEqual([]);
	});

	it('carries the tokenized equities the product exists to hold', () => {
		const equities = snapshot.tokens.filter((t) => t.assetClass === 'rwa-equity');
		expect(equities.length).toBeGreaterThan(50);
		// NVDA is the deepest equity on the chain; if it is missing, the market-data
		// fan-out has silently dropped tokens again (it did once, when 30 addresses
		// were batched into an endpoint that caps its response at 30 pairs).
		expect(equities.some((t) => t.symbol === 'NVDA')).toBe(true);
	});

	it('resolves a contested ticker to exactly one canonical contract', () => {
		const bySymbol = new Map();
		for (const t of snapshot.tokens) {
			const key = (t.symbol || '').toUpperCase();
			if (!key) continue;
			if (!bySymbol.has(key)) bySymbol.set(key, []);
			bySymbol.get(key).push(t);
		}
		const contested = [...bySymbol.entries()].filter(([, peers]) => peers.length > 1);
		// This chain really does have ticker squatting; if that ever stops being
		// true the assertion below is still correct, it just has nothing to check.
		for (const [symbol, peers] of contested) {
			const canonical = peers.filter((t) => t.canonical);
			expect(canonical.length, `${symbol} must have exactly one canonical contract`).toBe(1);
		}
	});
});

describe('validateScreen', () => {
	it('drops a constituent the model invented', () => {
		const tokens = realTokens(6);
		const raw = {
			name: 'Invented',
			symbol: 'INV',
			rebalanceDays: 30,
			constituents: [
				...tokens.slice(0, 3).map((t) => ({ address: t.address, weightBps: 3000, rationale: 'real' })),
				{ address: '0x' + 'de'.repeat(20), weightBps: 1000, rationale: 'hallucinated' },
			],
		};
		const out = validateScreen(raw, tokens);
		expect(out.constituents).toHaveLength(3);
		expect(out.constituents.some((c) => c.address === '0x' + 'de'.repeat(20))).toBe(false);
	});

	it('drops duplicates of the same address', () => {
		const tokens = realTokens(6);
		const raw = {
			constituents: [
				{ address: tokens[0].address, weightBps: 4000 },
				{ address: tokens[0].address.toUpperCase(), weightBps: 3000 },
				{ address: tokens[1].address, weightBps: 2000 },
				{ address: tokens[2].address, weightBps: 1000 },
			],
		};
		const out = validateScreen(raw, tokens);
		const addresses = out.constituents.map((c) => c.address);
		expect(new Set(addresses).size).toBe(addresses.length);
	});

	it('refuses a basket that is too small to be a portfolio', () => {
		const tokens = realTokens(6);
		expect(() =>
			validateScreen({ constituents: [{ address: tokens[0].address, weightBps: 10_000 }] }, tokens),
		).toThrow(/usable constituents/);
	});

	it('caps the number of constituents', () => {
		const tokens = realTokens(20);
		const raw = { constituents: tokens.map((t) => ({ address: t.address, weightBps: 500 })) };
		const out = validateScreen(raw, tokens);
		expect(out.constituents.length).toBeLessThanOrEqual(MAX_CONSTITUENTS);
		expect(out.constituents.length).toBeGreaterThanOrEqual(MIN_CONSTITUENTS);
	});

	it('normalises any weights the model returns to exactly 10000', () => {
		const tokens = realTokens(10);
		// Deliberately nothing like a valid distribution: wrong total, one leg way
		// over the cap, and a mix of magnitudes.
		const cases = [
			[9999, 1, 1],
			[50, 50, 50, 50],
			[9000, 9000, 9000],
			[1, 2, 3, 4, 5, 6, 7],
			[10_000, 1, 1, 1],
		];
		for (const weights of cases) {
			const raw = {
				constituents: weights.map((w, i) => ({ address: tokens[i].address, weightBps: w })),
			};
			const out = validateScreen(raw, tokens);
			const sum = out.constituents.reduce((s, c) => s + c.weightBps, 0);
			expect(sum, `weights ${weights.join('/')} must normalise to 10000`).toBe(10_000);
			for (const c of out.constituents) {
				expect(c.weightBps).toBeGreaterThan(0);
				expect(c.weightBps).toBeLessThanOrEqual(MAX_WEIGHT_BPS);
			}
		}
	});

	it('falls back to a sane schedule and symbol when the model returns nonsense', () => {
		const tokens = realTokens(4);
		const out = validateScreen(
			{
				name: '',
				symbol: '!!',
				rebalanceDays: 3,
				constituents: tokens.slice(0, 3).map((t) => ({ address: t.address, weightBps: 3333 })),
			},
			tokens,
		);
		expect([7, 14, 30, 90]).toContain(out.rebalanceDays);
		expect(out.symbol).toMatch(/^[A-Z]{3,6}$/);
		expect(out.name.length).toBeGreaterThan(0);
	});
});

describe('normaliseWeights', () => {
	// The property that matters: whatever a model returns, the result is a valid
	// distribution. This is the check that caught the original implementation,
	// which could not close a large deficit left behind by capping (9999/1/1
	// normalised to 3502 instead of 10000).
	it('always sums to exactly 10000 within the cap, for randomised inputs', () => {
		let seed = 0x5eed;
		const rand = () => {
			// xorshift, so a failure is reproducible rather than flaky.
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return Math.abs(seed) / 2 ** 31;
		};

		for (let trial = 0; trial < 2000; trial++) {
			const n = 3 + Math.floor(rand() * (MAX_CONSTITUENTS - 2));
			const raw = Array.from({ length: n }, () => {
				const magnitude = 10 ** Math.floor(rand() * 5);
				return Math.max(1, Math.floor(rand() * magnitude));
			});
			const out = normaliseWeights(raw, MAX_WEIGHT_BPS);
			const sum = out.reduce((a, b) => a + b, 0);
			expect(sum, `n=${n} raw=${raw.join('/')} -> ${out.join('/')}`).toBe(10_000);
			for (const w of out) {
				expect(w).toBeGreaterThanOrEqual(1);
				expect(w).toBeLessThanOrEqual(MAX_WEIGHT_BPS);
			}
			expect(out).toHaveLength(n);
		}
	});

	it('handles the degenerate inputs a model actually produces', () => {
		const cases = [
			[1, 1, 1],
			[10_000, 10_000, 10_000],
			[1, 1, 1_000_000],
			[3333, 3333, 3334],
			[0.5, 0.5, 0.5],
		];
		for (const raw of cases) {
			const out = normaliseWeights(raw, MAX_WEIGHT_BPS);
			expect(out.reduce((a, b) => a + b, 0), raw.join('/')).toBe(10_000);
		}
	});

	it('refuses a cap that cannot reach the total', () => {
		// 2 legs at 3500 can only reach 7000. Better to fail loudly than to return
		// a distribution that silently does not sum to a whole.
		expect(() => normaliseWeights([1, 1], MAX_WEIGHT_BPS)).toThrow();
	});
});

describe('manifest hashing', () => {
	it('is stable under key reordering, because the hash is committed on-chain', () => {
		const a = { z: 1, a: { n: [1, 2, 3], m: 'x' }, k: true };
		const b = { k: true, a: { m: 'x', n: [1, 2, 3] }, z: 1 };
		expect(canonicalise(a)).toBe(canonicalise(b));
		expect(manifestHash(a)).toBe(manifestHash(b));
	});

	it('changes when any committed value changes', () => {
		const tokens = realTokens(4);
		const screen = validateScreen(
			{
				name: 'Base',
				symbol: 'BASE',
				thesis: 't',
				rebalanceDays: 30,
				constituents: tokens.slice(0, 3).map((t) => ({ address: t.address, weightBps: 3333 })),
			},
			tokens,
		);
		const universe = { universeBuiltAt: snapshot.generatedAt, generatedAtBlock: 1, count: 10 };
		const one = buildManifest({ prompt: 'a', screen, universe, createdAt: '2026-01-01T00:00:00.000Z' });
		const two = buildManifest({ prompt: 'b', screen, universe, createdAt: '2026-01-01T00:00:00.000Z' });
		expect(manifestHash(one)).not.toBe(manifestHash(two));
		// Same inputs must reproduce the same commitment.
		const again = buildManifest({ prompt: 'a', screen, universe, createdAt: '2026-01-01T00:00:00.000Z' });
		expect(manifestHash(again)).toBe(manifestHash(one));
	});

	it('produces a 32-byte hex commitment', () => {
		expect(manifestHash({ a: 1 })).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it('distinguishes values JSON.stringify would render alike', () => {
		expect(canonicalise({ a: '1' })).not.toBe(canonicalise({ a: 1 }));
		expect(canonicalise({ a: null })).not.toBe(canonicalise({ a: 'null' }));
	});
});

describe('valueBasket', () => {
	const basket = [
		{ address: '0xaaa', symbol: 'A', weightBps: 5000 },
		{ address: '0xbbb', symbol: 'B', weightBps: 5000 },
	];

	it('values a fully priced basket', () => {
		const prices = new Map([
			['0xaaa', 100],
			['0xbbb', 50],
		]);
		const out = valueBasket(basket, prices);
		expect(out.navUsdPerUnit).toBeCloseTo(75, 10);
		expect(out.unpriceable).toEqual([]);
		expect(out.pricedLegs).toBe(2);
	});

	it('withholds NAV entirely when a leg is unpriceable', () => {
		const prices = new Map([['0xaaa', 100]]);
		const out = valueBasket(basket, prices);
		// The whole point: a partial NAV presented as a complete one is worse than
		// no NAV, because it silently understates the basket by the missing leg.
		expect(out.navUsdPerUnit).toBeNull();
		expect(out.unpriceable).toHaveLength(1);
		expect(out.unpriceable[0].symbol).toBe('B');
		expect(out.pricedLegs).toBe(1);
		expect(out.totalLegs).toBe(2);
	});

	it('treats a zero or negative price as unpriceable rather than as free', () => {
		for (const bad of [0, -1]) {
			const out = valueBasket(basket, new Map([['0xaaa', 100], ['0xbbb', bad]]));
			expect(out.navUsdPerUnit).toBeNull();
			expect(out.unpriceable).toHaveLength(1);
		}
	});
});
