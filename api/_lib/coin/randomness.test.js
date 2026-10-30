// Property-based tests for the lottery randomness primitives.
//
// fast-check generates thousands of inputs per property and shrinks failing
// cases to minimal reproductions. We test the *properties* the primitives
// promise (uniformity, determinism, monotonicity) rather than hard-coded
// examples — example-based tests can't catch a 0.5% bias toward index N.
//
// NOTE: this file lives next to the source rather than under /tests/* because
// it co-locates with the coin module it covers. Vitest's include glob
// (vitest.config.js) picks up `api/_lib/coin/**/*.test.js`, so `npm test` runs
// it automatically alongside the rest of the suite.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

import {
	roundForTime,
	timeForRound,
	drandRoundMessage,
	seedFor,
	bigintPRNG,
	weightedPick,
	weightsHash,
	DRAND,
} from './randomness.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** fast-check arbitrary for a 32-byte Uint8Array seed. */
const arbSeed = fc.uint8Array({ minLength: 32, maxLength: 32 });

/** Generate a non-empty weight array of small positive bigints. */
const arbWeights = fc
	.array(
		fc.integer({ min: 1, max: 1_000_000 }).map((n) => BigInt(n)),
		{ minLength: 1, maxLength: 50 },
	);

/** Compute the expected probability of each index given a weight array. */
function expectedProbs(weights) {
	const total = weights.reduce((a, w) => a + Number(w), 0);
	return weights.map((w) => Number(w) / total);
}

// ─── roundForTime / timeForRound (inverse pair) ─────────────────────────────

describe('roundForTime / timeForRound', () => {
	it('round-trips through Drand period arithmetic', () => {
		fc.assert(
			fc.property(
				fc.integer({
					min: DRAND.genesis + DRAND.period,
					max: DRAND.genesis + DRAND.period * 10_000_000,
				}),
				(t) => {
					const r = roundForTime(t, 0);
					const recoveredT = timeForRound(r);
					// roundForTime returns the round whose start ≥ t.
					expect(recoveredT).toBeGreaterThanOrEqual(t - DRAND.period);
					expect(recoveredT).toBeLessThanOrEqual(t + DRAND.period * 2);
				},
			),
			{ numRuns: 200 },
		);
	});

	it('bufferRounds shifts the result by exactly that many rounds', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: DRAND.genesis + 60, max: DRAND.genesis + 86_400 * 365 }),
				fc.integer({ min: 0, max: 100 }),
				(t, buf) => {
					const r0 = roundForTime(t, 0);
					const rBuf = roundForTime(t, buf);
					expect(rBuf - r0).toBe(buf);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('rejects timestamps before genesis', () => {
		expect(() => roundForTime(DRAND.genesis - 1)).toThrow();
	});
});

// ─── drandRoundMessage ──────────────────────────────────────────────────────

describe('drandRoundMessage', () => {
	it('is deterministic — same round → same 32-byte message', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (round) => {
				const a = drandRoundMessage(round);
				const b = drandRoundMessage(round);
				expect(a.length).toBe(32);
				expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
			}),
			{ numRuns: 50 },
		);
	});

	it('different rounds → different messages (collision-resistant)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 1_000_000 }),
				fc.integer({ min: 1, max: 1_000_000 }),
				(a, b) => {
					fc.pre(a !== b);
					const ma = Buffer.from(drandRoundMessage(a));
					const mb = Buffer.from(drandRoundMessage(b));
					expect(Buffer.compare(ma, mb)).not.toBe(0);
				},
			),
			{ numRuns: 200 },
		);
	});

	it('matches sha256(uint64_be(round)) exactly', () => {
		// Manual cross-check against the reference computation.
		const round = 28_691_000;
		const u64 = Buffer.alloc(8);
		u64.writeBigUInt64BE(BigInt(round));
		const expected = Buffer.from(sha256(u64));
		const actual = Buffer.from(drandRoundMessage(round));
		expect(Buffer.compare(expected, actual)).toBe(0);
	});
});

// ─── seedFor ────────────────────────────────────────────────────────────────

describe('seedFor', () => {
	it('binds randomness + salt — changing either changes the seed', () => {
		fc.assert(
			fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Buffer.from(b).toString('hex')), fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Buffer.from(b).toString('hex')), (r, s) => {
				const seedRS = Buffer.from(seedFor(r, s));
				// Different salt → different seed.
				const altSalt = s === '00'.repeat(32) ? '11'.repeat(32) : '00'.repeat(32);
				const seedRAlt = Buffer.from(seedFor(r, altSalt));
				expect(Buffer.compare(seedRS, seedRAlt)).not.toBe(0);
				// Different randomness → different seed.
				const altR = r === '00'.repeat(32) ? '11'.repeat(32) : '00'.repeat(32);
				const seedAltS = Buffer.from(seedFor(altR, s));
				expect(Buffer.compare(seedRS, seedAltS)).not.toBe(0);
			}),
			{ numRuns: 50 },
		);
	});

	it('is deterministic — same inputs produce same seed', () => {
		fc.assert(
			fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Buffer.from(b).toString('hex')), fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Buffer.from(b).toString('hex')), (r, s) => {
				expect(Buffer.compare(Buffer.from(seedFor(r, s)), Buffer.from(seedFor(r, s)))).toBe(0);
			}),
			{ numRuns: 50 },
		);
	});
});

// ─── bigintPRNG ─────────────────────────────────────────────────────────────

describe('bigintPRNG', () => {
	it('is deterministic — same seed → same sequence', () => {
		fc.assert(
			fc.property(arbSeed, (seed) => {
				const a = bigintPRNG(seed);
				const b = bigintPRNG(seed);
				for (let i = 0; i < 100; i++) {
					expect(a.next()).toBe(b.next());
				}
			}),
			{ numRuns: 30 },
		);
	});

	it('produces 64-bit values', () => {
		const MAX = (1n << 64n) - 1n;
		fc.assert(
			fc.property(arbSeed, (seed) => {
				const prng = bigintPRNG(seed);
				for (let i = 0; i < 100; i++) {
					const v = prng.next();
					expect(v >= 0n && v <= MAX).toBe(true);
				}
			}),
			{ numRuns: 30 },
		);
	});

	it('throws on a seed shorter than 16 bytes', () => {
		expect(() => bigintPRNG(new Uint8Array(8))).toThrow();
	});

	it('different seeds produce different sequences (almost surely)', () => {
		fc.assert(
			fc.property(arbSeed, arbSeed, (seedA, seedB) => {
				fc.pre(Buffer.compare(Buffer.from(seedA), Buffer.from(seedB)) !== 0);
				const a = bigintPRNG(seedA);
				const b = bigintPRNG(seedB);
				const firstA = [a.next(), a.next(), a.next()];
				const firstB = [b.next(), b.next(), b.next()];
				// The probability of three consecutive collisions for distinct
				// seeds is < 2^-192 — effectively impossible.
				expect(firstA[0] === firstB[0] && firstA[1] === firstB[1] && firstA[2] === firstB[2]).toBe(
					false,
				);
			}),
			{ numRuns: 30 },
		);
	});
});

// ─── weightedPick — the core lottery primitive ──────────────────────────────

describe('weightedPick', () => {
	it('returns a valid index for any non-empty weight set', () => {
		fc.assert(
			fc.property(arbWeights, arbSeed, (weights, seed) => {
				const idx = weightedPick(weights, seed);
				expect(idx).toBeGreaterThanOrEqual(0);
				expect(idx).toBeLessThan(weights.length);
			}),
			{ numRuns: 200 },
		);
	});

	it('is deterministic — same weights + same seed → same index', () => {
		fc.assert(
			fc.property(arbWeights, arbSeed, (weights, seed) => {
				expect(weightedPick(weights, seed)).toBe(weightedPick(weights, seed));
			}),
			{ numRuns: 100 },
		);
	});

	it('throws on an empty weight set', () => {
		expect(() => weightedPick([], randomBytes(32))).toThrow();
	});

	it('throws when total weight is zero', () => {
		expect(() => weightedPick([0n, 0n, 0n], randomBytes(32))).toThrow();
	});

	it('throws on a negative weight', () => {
		expect(() => weightedPick([5n, -1n, 3n], randomBytes(32))).toThrow();
	});

	it('always picks the only valid index when one weight dominates and others are zero', () => {
		fc.assert(
			fc.property(arbSeed, fc.integer({ min: 0, max: 4 }), (seed, dominantIdx) => {
				const weights = [0n, 0n, 0n, 0n, 0n];
				weights[dominantIdx] = 1000n;
				expect(weightedPick(weights, seed)).toBe(dominantIdx);
			}),
			{ numRuns: 50 },
		);
	});

	it('distribution converges to expected probabilities (chi-square sanity)', () => {
		// We can't run a true chi-square here (it'd be flaky), but we can assert
		// each bucket lands within ±2.5% of its expected probability across 50k
		// samples — generous enough to avoid flake while still catching the
		// pre-fix "100% to last weight" regression that bit us during build.
		const weights = [100n, 200n, 300n, 400n];
		const n = 50_000;
		const counts = [0, 0, 0, 0];
		for (let i = 0; i < n; i++) {
			counts[weightedPick(weights, randomBytes(32))]++;
		}
		const expected = expectedProbs(weights);
		for (let i = 0; i < counts.length; i++) {
			const observed = counts[i] / n;
			expect(Math.abs(observed - expected[i])).toBeLessThan(0.025);
		}
	});

	it('respects ratio between large skewed weights (100:1)', () => {
		const weights = [1n, 100n];
		let bigCount = 0;
		const n = 10_000;
		for (let i = 0; i < n; i++) {
			if (weightedPick(weights, randomBytes(32)) === 1) bigCount++;
		}
		// Expected ~99.0% for index 1. Allow a 1.5% slop.
		expect(bigCount / n).toBeGreaterThan(0.975);
		expect(bigCount / n).toBeLessThan(1.0);
	});

	it('handles weight totals that exceed 2^64 (multi-chunk rejection sampling)', () => {
		const huge = (1n << 80n) + 1n;
		const weights = [huge, huge, huge];
		// Should not throw and should return a valid index.
		const idx = weightedPick(weights, randomBytes(32));
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(idx).toBeLessThan(3);
	});
});

// ─── weightsHash — audit commit hash ────────────────────────────────────────

describe('weightsHash', () => {
	it('is order-invariant — sorting wallets before hashing means tuple order does not affect the result', () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						wallet: fc
							.stringMatching(/^[A-Za-z0-9]{8,32}$/)
							.filter((s) => s.length > 0),
						weight: fc.integer({ min: 1, max: 1_000_000 }).map((n) => BigInt(n)),
					}),
					{ minLength: 1, maxLength: 50 },
				),
				(entries) => {
					// Dedupe by wallet (the hash collapses duplicates on wallet,
					// since `Map` semantics would; but our function doesn't
					// dedupe — sort only — so we test that explicitly).
					const unique = [];
					const seen = new Set();
					for (const e of entries) {
						if (seen.has(e.wallet)) continue;
						seen.add(e.wallet);
						unique.push(e);
					}
					const h1 = weightsHash(unique);
					const shuffled = [...unique].reverse();
					const h2 = weightsHash(shuffled);
					expect(h1).toBe(h2);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('changes when any weight changes', () => {
		const entries = [
			{ wallet: 'aaa', weight: 100n },
			{ wallet: 'bbb', weight: 200n },
		];
		const h1 = weightsHash(entries);
		const h2 = weightsHash([
			{ wallet: 'aaa', weight: 100n },
			{ wallet: 'bbb', weight: 201n }, // bumped by 1
		]);
		expect(h1).not.toBe(h2);
	});

	it('changes when any wallet is added or removed', () => {
		const base = [
			{ wallet: 'aaa', weight: 100n },
			{ wallet: 'bbb', weight: 200n },
		];
		const added = [...base, { wallet: 'ccc', weight: 50n }];
		const removed = base.slice(0, 1);
		expect(weightsHash(base)).not.toBe(weightsHash(added));
		expect(weightsHash(base)).not.toBe(weightsHash(removed));
	});

	it('produces a 64-char hex digest', () => {
		const h = weightsHash([{ wallet: 'aaa', weight: 1n }]);
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});
});
