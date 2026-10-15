// Unit tests for the wallet reputation scoring engine.
//
// The pure computeReputation() function is the trust primitive — these tests pin
// the properties the score must hold to be credible: a new agent reads as new,
// costly signals dominate cheap ones, self-tips and single-counterparty volume
// are discounted, and the tier ladder requires real counterparty diversity.

import { describe, it, expect } from 'vitest';
import { computeReputation, tierFor, MAX_SCORE, PILLARS, REPUTATION_VERSION } from '../api/_lib/trust/wallet-reputation.js';

const NEW_AGENT = {
	ageDays: 0,
	activeDays90: 0,
	externalTipUsd: 0,
	settledUsd: 0,
	tipCount: 0,
	distinctTippers: 0,
	selfTipCount: 0,
	washTipCount: 0,
	washTipUsd: 0,
	confirmedPayments: 0,
	failedPayments: 0,
	distinctPayers: 0,
	distributionSuccess: 0,
	tipsGivenUsd: 0,
	tipsGivenCount: 0,
	reciprocalPairs: 0,
	closedTrades: 0,
	winningTrades: 0,
	realizedPnlSol: 0,
	dumpEvents: 0,
	reserveUsd: 0,
	obligationsUsd: 0,
	reservesKnown: false,
	forkCount: 0,
	hasOnchainIdentity: false,
	registryAverage: 0,
	registryCount: 0,
	validationCount: 0,
	feedbackCount: 0,
	hasSkillCollection: false,
};

const ESTABLISHED = {
	...NEW_AGENT,
	ageDays: 220,
	activeDays90: 40,
	externalTipUsd: 1200,
	settledUsd: 3500,
	tipCount: 18,
	distinctTippers: 9,
	confirmedPayments: 24,
	failedPayments: 1,
	distinctPayers: 11,
	distributionSuccess: 1,
	forkCount: 5,
	hasOnchainIdentity: true,
	registryAverage: 4.6,
	registryCount: 7,
	validationCount: 2,
	feedbackCount: 5,
	hasSkillCollection: true,
};

describe('computeReputation — pillar maxima', () => {
	it('pillar maxima sum to 100', () => {
		expect(MAX_SCORE).toBe(100);
		expect(PILLARS.reduce((s, p) => s + p.max, 0)).toBe(100);
	});

	it('no pillar can exceed its max even with absurd inputs', () => {
		const r = computeReputation({
			...ESTABLISHED,
			ageDays: 1e9,
			settledUsd: 1e12,
			externalTipUsd: 1e12,
			distinctTippers: 1e6,
			forkCount: 1e6,
			registryAverage: 100,
			registryCount: 1e6,
			validationCount: 1e6,
			threeUsd: 1e12,
			threeTokens: 1e12,
			threeHoldDays: 1e6,
		});
		for (const p of r.pillars) expect(p.points).toBeLessThanOrEqual(p.max);
		expect(r.score).toBeLessThanOrEqual(100);
	});

	it('exposes the current reputation version', () => {
		expect(REPUTATION_VERSION).toBe(4);
		expect(PILLARS.some((p) => p.key === 'conviction')).toBe(true);
	});
});

describe('new-agent honesty', () => {
	it('a brand-new agent reads as "new" with a near-zero score', () => {
		const r = computeReputation(NEW_AGENT);
		expect(r.isNew).toBe(true);
		expect(r.tier).toBe('new');
		expect(r.score).toBeLessThan(2);
	});

	it('age alone does not manufacture peer trust', () => {
		// An old, verified wallet with NO counterparties cannot reach "trusted".
		const r = computeReputation({
			...NEW_AGENT,
			ageDays: 900,
			activeDays90: 30,
			hasOnchainIdentity: true,
			registryAverage: 5,
			registryCount: 3,
		});
		expect(['emerging', 'established']).toContain(r.tier);
		expect(r.tier).not.toBe('trusted');
		expect(r.tier).not.toBe('elite');
	});
});

describe('anti-gaming', () => {
	it('self-tips are ignored and surfaced as discounted', () => {
		const withSelf = computeReputation({ ...NEW_AGENT, ageDays: 100, selfTipCount: 50, tipCount: 50, distinctTippers: 0 });
		const without = computeReputation({ ...NEW_AGENT, ageDays: 100 });
		// Self-tips contribute nothing to the score.
		expect(withSelf.score).toBeCloseTo(without.score, 1);
		expect(withSelf.discounted.some((d) => d.kind === 'self_tips')).toBe(true);
	});

	it('single-counterparty volume is discounted vs many distinct tippers', () => {
		const concentrated = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			tipCount: 40,
			distinctTippers: 1,
			externalTipUsd: 5000,
			settledUsd: 5000,
		});
		const diverse = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			tipCount: 40,
			distinctTippers: 20,
			externalTipUsd: 5000,
			settledUsd: 5000,
		});
		expect(diverse.score).toBeGreaterThan(concentrated.score);
		expect(concentrated.discounted.some((d) => d.kind === 'concentration')).toBe(true);
	});
});

describe('costly signals dominate', () => {
	it('an established, diverse, verified agent scores well and earns a real tier', () => {
		const r = computeReputation(ESTABLISHED);
		expect(r.score).toBeGreaterThan(55);
		expect(['trusted', 'elite']).toContain(r.tier);
		expect(r.isNew).toBe(false);
	});

	it('reliability is zero until there is real settlement volume', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100, confirmedPayments: 2, failedPayments: 0 });
		const rel = r.pillars.find((p) => p.key === 'reliability');
		expect(rel.points).toBe(0);
	});
});

describe('hire fulfillment rate', () => {
	it('below the minimum sample, fulfillment contributes nothing even with a perfect rate', () => {
		const r = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			hireFulfillmentRate: 1,
			hireFulfillmentSampleSize: 2,
			hireFulfillmentMinSample: 5,
		});
		const rel = r.pillars.find((p) => p.key === 'reliability');
		expect(rel.points).toBe(0);
		expect(rel.facts.hire_fulfillment_rate).toBeNull();
		expect(rel.facts.hire_fulfillment_sample_size).toBe(2);
	});

	it('at or above the minimum sample, a strong fulfillment rate earns reliability points', () => {
		const r = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			hireFulfillmentRate: 0.9,
			hireFulfillmentSampleSize: 8,
			hireFulfillmentMinSample: 5,
		});
		const rel = r.pillars.find((p) => p.key === 'reliability');
		expect(rel.points).toBeGreaterThan(0);
		expect(rel.facts.hire_fulfillment_rate).toBeCloseTo(90, 0);
		expect(rel.facts.hire_fulfillment_sample_size).toBe(8);
		expect(rel.detail).toMatch(/90% hire fulfillment over 8 hires/);
	});

	it('a poor fulfillment rate earns fewer reliability points than a strong one', () => {
		const strong = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			hireFulfillmentRate: 1,
			hireFulfillmentSampleSize: 10,
		});
		const weak = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			hireFulfillmentRate: 0.1,
			hireFulfillmentSampleSize: 10,
		});
		const strongRel = strong.pillars.find((p) => p.key === 'reliability');
		const weakRel = weak.pillars.find((p) => p.key === 'reliability');
		expect(strongRel.points).toBeGreaterThan(weakRel.points);
	});

	it('never pushes the reliability pillar above its max even with strong payment + hire signal', () => {
		const r = computeReputation({
			...ESTABLISHED,
			hireFulfillmentRate: 1,
			hireFulfillmentSampleSize: 50,
		});
		const rel = r.pillars.find((p) => p.key === 'reliability');
		expect(rel.points).toBeLessThanOrEqual(rel.max);
	});
});

describe('generosity factor', () => {
	it('rewards tips given to other agents (wash-excluded upstream)', () => {
		const generous = computeReputation({ ...NEW_AGENT, ageDays: 100, tipsGivenUsd: 800, tipsGivenCount: 12 });
		const stingy = computeReputation({ ...NEW_AGENT, ageDays: 100 });
		const gp = generous.pillars.find((p) => p.key === 'generosity');
		expect(gp.points).toBeGreaterThan(0);
		expect(generous.score).toBeGreaterThan(stingy.score);
	});

	it('a two-way relationship adds reciprocity points', () => {
		const oneWay = computeReputation({ ...NEW_AGENT, ageDays: 100, tipsGivenUsd: 500, tipsGivenCount: 5, externalTipUsd: 0 });
		const twoWay = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			tipsGivenUsd: 500,
			tipsGivenCount: 5,
			externalTipUsd: 500,
			distinctTippers: 4,
			tipCount: 5,
			reciprocalPairs: 2,
		});
		const a = oneWay.pillars.find((p) => p.key === 'generosity').points;
		const b = twoWay.pillars.find((p) => p.key === 'generosity').points;
		expect(b).toBeGreaterThan(a);
	});
});

describe('trading conduct factor', () => {
	it('is unproven (0) until at least 3 closed trades', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100, closedTrades: 2, winningTrades: 2, realizedPnlSol: 5 });
		expect(r.pillars.find((p) => p.key === 'conduct').points).toBe(0);
	});

	it('rewards a profitable, high-win-rate record', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100, closedTrades: 20, winningTrades: 16, realizedPnlSol: 30 });
		expect(r.pillars.find((p) => p.key === 'conduct').points).toBeGreaterThan(5);
	});

	it('penalises dumping on supporters and surfaces it as discounted', () => {
		const clean = computeReputation({ ...NEW_AGENT, ageDays: 100, closedTrades: 20, winningTrades: 16, realizedPnlSol: 30 });
		const dumper = computeReputation({
			...NEW_AGENT,
			ageDays: 100,
			closedTrades: 20,
			winningTrades: 16,
			realizedPnlSol: 30,
			dumpEvents: 3,
		});
		expect(dumper.pillars.find((p) => p.key === 'conduct').points).toBeLessThan(
			clean.pillars.find((p) => p.key === 'conduct').points,
		);
		expect(dumper.discounted.some((d) => d.kind === 'dump')).toBe(true);
	});
});

describe('solvency factor', () => {
	it('is 0 / unknown when reserves were not measured', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100, reserveUsd: 5000, obligationsUsd: 100, reservesKnown: false });
		expect(r.pillars.find((p) => p.key === 'solvency').points).toBe(0);
	});

	it('scores full coverage above partial coverage', () => {
		const covered = computeReputation({ ...NEW_AGENT, ageDays: 100, reserveUsd: 1000, obligationsUsd: 500, reservesKnown: true });
		const thin = computeReputation({ ...NEW_AGENT, ageDays: 100, reserveUsd: 100, obligationsUsd: 500, reservesKnown: true });
		const a = covered.pillars.find((p) => p.key === 'solvency').points;
		const b = thin.pillars.find((p) => p.key === 'solvency').points;
		expect(a).toBeGreaterThan(b);
		expect(a).toBeGreaterThan(0);
	});
});

describe('anti-gaming — cross-agent wash tips', () => {
	it('surfaces wash-tips as discounted', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100, washTipCount: 6, washTipUsd: 300 });
		expect(r.discounted.some((d) => d.kind === 'wash_tips')).toBe(true);
	});
});

describe('$THREE conviction factor', () => {
	const conv = (r) => r.pillars.find((p) => p.key === 'conviction').points;

	it('is 0 when the wallet holds no $THREE', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100 });
		expect(conv(r)).toBe(0);
	});

	it('rewards holding $THREE, and longer holding more', () => {
		const short = computeReputation({ ...NEW_AGENT, ageDays: 100, threeUsd: 500, threeTokens: 1000, threeHoldDays: 2 });
		const long = computeReputation({ ...NEW_AGENT, ageDays: 100, threeUsd: 500, threeTokens: 1000, threeHoldDays: 120 });
		expect(conv(short)).toBeGreaterThan(0);
		expect(conv(long)).toBeGreaterThan(conv(short));
		expect(long.score).toBeGreaterThan(short.score);
	});

	it("a whale's value alone can't buy the whole pillar (log-scaled, capped)", () => {
		const whaleFlash = computeReputation({ ...NEW_AGENT, ageDays: 100, threeUsd: 1e9, threeTokens: 1e9, threeHoldDays: 0 });
		// No duration → value sub-cap (6) is the ceiling, never the full 10.
		expect(conv(whaleFlash)).toBeLessThanOrEqual(6.0001);
	});

	it('duration is price-independent — it still counts if the price feed is down', () => {
		const r = computeReputation({ ...NEW_AGENT, ageDays: 100, threeUsd: 0, threeTokens: 5000, threeHoldDays: 120 });
		expect(conv(r)).toBeGreaterThan(0);
	});

	it('holding $THREE is real activity — the agent is no longer "new"', () => {
		const r = computeReputation({ ...NEW_AGENT, threeUsd: 50, threeTokens: 100, threeHoldDays: 10 });
		expect(r.isNew).toBe(false);
		expect(r.totals.holds_three).toBe(true);
	});
});

describe('tierFor gating', () => {
	it('requires counterparty diversity for trusted/elite', () => {
		expect(tierFor({ score: 80, isNew: false, distinctTippers: 0, confirmedPayments: 0 })).toBe('established');
		expect(tierFor({ score: 80, isNew: false, distinctTippers: 5, confirmedPayments: 0 })).toBe('elite');
		expect(tierFor({ score: 60, isNew: false, distinctTippers: 0, confirmedPayments: 12 })).toBe('trusted');
	});
});
