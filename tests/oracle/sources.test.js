// Oracle source adapter — toCoinIntel mapping. Pure given its row inputs, so we
// pin the brain→CoinIntel translation (lamports, proxies, narrative fallback)
// that the conviction engine depends on.

import { describe, it, expect } from 'vitest';
import { toCoinIntel } from '../../api/_lib/oracle/sources.js';
import { xHandleFromLink, xAccountSignal } from '../../api/_lib/oracle/x-account.js';

const coinRow = {
	mint: 'MintAAA', symbol: 'AAA', name: 'Alpha', image_uri: 'x', category: 'ai',
	narrative: 'an AI agent', classify_confidence: 0.7,
	created_at: '2026-06-16T00:00:00Z', first_seen_at: '2026-06-16T00:00:01Z',
	dev_buy_lamports: '500000000', dev_sold: false, dev_sell_lamports: '0',
	buy_count: 30, sell_count: 4, buy_volume_lamports: '5000000000', sell_volume_lamports: '400000000',
	unique_buyers: 42, largest_buy_lamports: '1000000000',
	bundle_score: 0.2, organic_score: 0.8, concentration_top10: 0.35, bubblemap_connectivity: 0.1,
	quality_score: 74, risk_flags: [],
};

describe('toCoinIntel', () => {
	it('maps lamports to SOL and percentages to 0..100', () => {
		const ci = toCoinIntel({ coin: coinRow, smart: null, narr: null });
		expect(ci.behavior.devBuySol).toBeCloseTo(0.5, 6);
		expect(ci.behavior.buyVolSol).toBeCloseTo(5, 6);
		expect(ci.structure.organicScore).toBeCloseTo(80, 6);
		expect(ci.structure.bundleScore).toBeCloseTo(20, 6);
		expect(ci.structure.top10Pct).toBeCloseTo(35, 6);
		// largest buy 1 SOL / 5 SOL volume = 20% top-holder proxy
		expect(ci.structure.topHolderPct).toBeCloseTo(20, 6);
	});

	it('flags a bundle when bundle_score is high or risk_flags say so', () => {
		expect(toCoinIntel({ coin: { ...coinRow, bundle_score: 0.7 }, smart: null, narr: null }).structure.bundleFlag).toBe(true);
		expect(toCoinIntel({ coin: { ...coinRow, risk_flags: ['bundle_launch'] }, smart: null, narr: null }).structure.bundleFlag).toBe(true);
		expect(toCoinIntel({ coin: coinRow, smart: null, narr: null }).structure.bundleFlag).toBe(false);
	});

	it('computes devSoldPct only when the dev has sold', () => {
		const sold = toCoinIntel({ coin: { ...coinRow, dev_sold: true, dev_sell_lamports: '250000000' }, smart: null, narr: null });
		expect(sold.structure.devSoldPct).toBeCloseTo(50, 6); // 0.25 / 0.5
		expect(toCoinIntel({ coin: coinRow, smart: null, narr: null }).structure.devSoldPct).toBe(0);
	});

	it('prefers an Oracle narrative (with virality) over the brain category', () => {
		const withNarr = toCoinIntel({ coin: coinRow, smart: null, narr: { category: 'news', narrative: 'live headline', virality: 88, confidence: 0.9 } });
		expect(withNarr.narrative.category).toBe('news');
		expect(withNarr.narrative.virality).toBe(88);
		expect(withNarr.category).toBe('news');
	});

	it('falls back to the brain category with a virality proxy when no Oracle narrative', () => {
		const ci = toCoinIntel({ coin: coinRow, smart: null, narr: null });
		expect(ci.narrative.category).toBe('ai');
		expect(ci.narrative.virality).toBeGreaterThan(0); // proxy from quality + organic
	});

	it('reads smart-money pedigree and notable wallets', () => {
		const ci = toCoinIntel({
			coin: coinRow,
			smart: { smart_money_score: 82, smart_wallet_count: 3, proven_buy_lamports: '2000000000', total_buy_lamports: '5000000000', notable: [{ wallet: 'w', label: 'smart_money', score: 90 }] },
			narr: null,
		});
		expect(ci.smartMoney.score).toBe(82);
		expect(ci.smartMoney.smartWalletCount).toBe(3);
		expect(ci.smartMoney.notable).toHaveLength(1);
	});

	it('parses notable when stored as a JSON string', () => {
		const ci = toCoinIntel({ coin: coinRow, smart: { notable: '[{"wallet":"w","label":"sniper","score":50}]' }, narr: null });
		expect(ci.smartMoney.notable[0].label).toBe('sniper');
	});
});

describe('linked X account signal', () => {
	it('carries xAccount onto intel.social, null when absent', () => {
		const xAccount = { handle: 'synthproj', ageDays: 3, followers: 41, verified: false, source: 'x-guest' };
		expect(toCoinIntel({ coin: coinRow, smart: null, narr: null, xAccount }).social.xAccount).toEqual(xAccount);
		expect(toCoinIntel({ coin: coinRow, smart: null, narr: null }).social.xAccount).toBeNull();
	});
});

describe('xHandleFromLink / xAccountSignal', () => {
	it('extracts handles from profile and status links, rejects non-profiles', () => {
		expect(xHandleFromLink('https://x.com/SynthProj')).toBe('SynthProj');
		expect(xHandleFromLink('https://twitter.com/synthproj/status/123')).toBe('synthproj');
		expect(xHandleFromLink('@synthproj')).toBe('synthproj');
		expect(xHandleFromLink('x.com/synthproj?s=20')).toBe('synthproj');
		expect(xHandleFromLink('https://x.com/i/communities/123')).toBeNull();
		expect(xHandleFromLink('https://example.com/synthproj')).toBeNull();
		expect(xHandleFromLink('')).toBeNull();
	});

	it('derives account age in days and follower count from the guest profile', async () => {
		const now = Date.parse('2026-02-01T00:00:00Z');
		const sig = await xAccountSignal('https://x.com/synthproj', {
			now: () => now,
			lookup: async () => ({ username: 'synthproj', joined: '2026-01-29T00:00:00.000Z', followers: 41, verified: false }),
		});
		expect(sig).toMatchObject({ handle: 'synthproj', ageDays: 3, followers: 41, source: 'x-guest' });
	});

	it('resolves null (unknown, not zero) when the reader fails', async () => {
		const sig = await xAccountSignal('https://x.com/synthfail', {
			lookup: async () => { throw Object.assign(new Error('down'), { reason: 'rate_limited' }); },
		});
		expect(sig).toBeNull();
	});
});
