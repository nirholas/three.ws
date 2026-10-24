// Unit tests for the $THREE gated-feature access registry (api/_lib/three-access.js).
// Balance/price reads are mocked (same rig as three-tier.test.js). These prove the
// full tier×feature eligibility matrix, the pure level check, the reason taxonomy
// (anonymous → sign_in, signed-in-no-wallet → link_wallet, under threshold →
// insufficient_tier), graceful degradation to Member on an RPC/price hiccup, the
// pay-per-use passthrough, and the typed 404 for an unknown feature.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBalances = vi.fn();
const getTokenPriceUsd = vi.fn();
vi.mock('../api/_lib/balances.js', () => ({ getBalances: (...a) => getBalances(...a) }));
vi.mock('../api/_lib/token/price.js', () => ({ getTokenPriceUsd: (...a) => getTokenPriceUsd(...a) }));

import {
	GATED_FEATURES,
	gatedFeature,
	requiredTierFor,
	listGatedFeatures,
	accessFromTierLevel,
	resolveAccess,
} from '../api/_lib/three-access.js';
import { TOKEN_MINT } from '../api/_lib/token/config.js';

const WALLET = 'So11111111111111111111111111111111111111112';

// Source-of-truth expectations, kept independent of the module under test so a
// silent change to the registry (a shifted threshold, a dropped feature) fails here.
const MIN_LEVEL = {
	'forge.high': 1,
	'forge.gameready': 1,
	'forge.keep': 1,
	'worlds.private': 2,
	'mcp.priority': 2,
	'worlds.branded': 3,
	'drops.early': 3,
	'names.first_dibs': 4,
};
const REQUIRED_TIER_ID = {
	'forge.high': 'bronze',
	'forge.gameready': 'bronze',
	'forge.keep': 'bronze',
	'worlds.private': 'silver',
	'mcp.priority': 'silver',
	'worlds.branded': 'gold',
	'drops.early': 'gold',
	'names.first_dibs': 'genesis',
};
const PAY_PER_USE = {
	'forge.high': 'forge.high',
	'forge.gameready': 'forge.gameready',
	'forge.keep': null,
	'worlds.private': null,
	'mcp.priority': null,
	'worlds.branded': null,
	'drops.early': null,
	'names.first_dibs': 'name.auction',
};
// forge.high (High-tier Forge gate) and forge.gameready (engine-ready export gate)
// are WIRED today. The rest are planned — registered so the UI can show them, but
// not yet enforced anywhere. /three reads this flag to mark each perk "Live" vs
// "Planned"; pinning it here makes flipping a feature to enforced a deliberate,
// tested change rather than a silent one.
const ENFORCED = {
	'forge.high': true,
	'forge.gameready': true,
	'forge.keep': false,
	'worlds.private': false,
	'mcp.priority': false,
	'worlds.branded': false,
	'drops.early': false,
	'names.first_dibs': false,
};
const TIER_ID_BY_LEVEL = ['member', 'bronze', 'silver', 'gold', 'genesis'];
const FEATURE_IDS = Object.keys(MIN_LEVEL);

// USD value of $THREE that resolves to each tier level (just over each threshold).
const USD_FOR_LEVEL = [0, 25, 100, 500, 2500];

// Make holderUsd resolve to `usd`: amount==usd, price==1 so both the entry-usd and
// the amount×price code paths agree, and usd=0 → amount 0 → the Member floor.
function mockHeldUsd(usd) {
	getBalances.mockResolvedValue({ tokens: [{ mint: TOKEN_MINT, amount: usd, usd, price: 1 }] });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('registry shape', () => {
	it('exposes exactly the registered gated features and is deeply frozen', () => {
		expect(listGatedFeatures().sort()).toEqual(FEATURE_IDS.slice().sort());
		expect(Object.isFrozen(GATED_FEATURES)).toBe(true);
		for (const id of FEATURE_IDS) {
			expect(Object.isFrozen(GATED_FEATURES[id])).toBe(true);
		}
	});

	it('every entry carries minLevel, holder-readable copy, a payPerUse key, and an enforced flag', () => {
		for (const id of FEATURE_IDS) {
			const f = GATED_FEATURES[id];
			expect(f.minLevel).toBe(MIN_LEVEL[id]);
			expect(typeof f.label).toBe('string');
			expect(f.label.length).toBeGreaterThan(0);
			expect(typeof f.why).toBe('string');
			expect(f.why.length).toBeGreaterThan(0);
			expect(f).toHaveProperty('payPerUse');
			expect(f.payPerUse).toBe(PAY_PER_USE[id]);
			expect(typeof f.enforced).toBe('boolean');
			expect(f.enforced).toBe(ENFORCED[id]);
		}
	});

	it('marks the wired Forge gates enforced today — the rest are planned', () => {
		const enforced = FEATURE_IDS.filter((id) => GATED_FEATURES[id].enforced);
		expect(enforced).toEqual(['forge.high', 'forge.gameready']);
	});

	it('references no coin other than $THREE in its copy', () => {
		// Strip the legitimate `.sol` SNS TLD (names.first_dibs targets *.threews.sol)
		// so it isn't mistaken for the SOL coin, then scan for foreign tickers.
		const blob = JSON.stringify(GATED_FEATURES).toLowerCase().replace(/\.sol\b/g, '');
		expect(blob).not.toMatch(/\busdc\b|\bbonk\b|\bwif\b|\bdoge\b|\bpepe\b|\bbtc\b|ethereum|\beth\b/);
	});
});

describe('gatedFeature / requiredTierFor', () => {
	it('returns the entry for a known feature', () => {
		expect(gatedFeature('forge.high')).toBe(GATED_FEATURES['forge.high']);
	});

	it('throws a typed 404 for an unknown feature', () => {
		let err;
		try {
			gatedFeature('forge.ultra');
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(404);
		expect(err.code).toBe('unknown_feature');
		expect(err.message).toContain('forge.ultra');
	});

	it('maps each feature to the correct required tier', () => {
		for (const id of FEATURE_IDS) {
			expect(requiredTierFor(id).id).toBe(REQUIRED_TIER_ID[id]);
			expect(requiredTierFor(id).level).toBe(MIN_LEVEL[id]);
		}
	});
});

describe('accessFromTierLevel — pure tier×feature matrix', () => {
	for (let level = 0; level <= 4; level++) {
		for (const id of FEATURE_IDS) {
			const eligible = level >= MIN_LEVEL[id];
			it(`level ${level} (${TIER_ID_BY_LEVEL[level]}) × ${id} → ${eligible ? 'eligible' : 'locked'}`, () => {
				const a = accessFromTierLevel(level, id);
				expect(a.eligible).toBe(eligible);
				expect(a.feature).toBe(id);
				expect(a.required.level).toBe(MIN_LEVEL[id]);
				expect(a.required.id).toBe(REQUIRED_TIER_ID[id]);
				expect(a.held.level).toBe(level);
				expect(a.held.id).toBe(TIER_ID_BY_LEVEL[level]);
				expect(a.pay_per_use).toBe(PAY_PER_USE[id]);
				expect(a.enforced).toBe(ENFORCED[id]);
				expect(a.reason).toBe(eligible ? 'eligible' : 'insufficient_tier');
			});
		}
	}

	it('does no I/O (never touches the balance reader)', () => {
		accessFromTierLevel(4, 'names.first_dibs');
		expect(getBalances).not.toHaveBeenCalled();
	});

	it('clamps an out-of-range level to the Member floor without throwing', () => {
		const a = accessFromTierLevel(-3, 'forge.high');
		expect(a.held.id).toBe('member');
		expect(a.eligible).toBe(false);
	});

	it('throws a typed 404 for an unknown feature', () => {
		expect(() => accessFromTierLevel(4, 'nope')).toThrow(/unknown gated feature/);
	});
});

describe('resolveAccess — anonymous and signed-in reasons', () => {
	it('anonymous user is Member, locked on every paid feature with reason sign_in, no RPC', async () => {
		for (const id of FEATURE_IDS) {
			const a = await resolveAccess(null, id);
			expect(a.eligible).toBe(false);
			expect(a.reason).toBe('sign_in');
			expect(a.held.id).toBe('member');
			expect(a.held.usd).toBe(0);
			expect(a.pay_per_use).toBe(PAY_PER_USE[id]);
		}
		expect(getBalances).not.toHaveBeenCalled();
	});

	it('signed-in user without a linked wallet is locked with reason link_wallet, no RPC', async () => {
		const a = await resolveAccess({ id: 'u1' }, 'forge.high');
		expect(a.eligible).toBe(false);
		expect(a.reason).toBe('link_wallet');
		expect(a.held.id).toBe('member');
		expect(getBalances).not.toHaveBeenCalled();
	});

	it('signed-in holder under the threshold is locked with reason insufficient_tier', async () => {
		mockHeldUsd(USD_FOR_LEVEL[1]); // bronze
		const a = await resolveAccess({ wallet_address: WALLET }, 'worlds.private'); // needs silver
		expect(a.held.id).toBe('bronze');
		expect(a.eligible).toBe(false);
		expect(a.reason).toBe('insufficient_tier');
		expect(a.pay_per_use).toBeNull();
	});

	it('surfaces the pay-per-use action when a non-holder can pay instead', async () => {
		const a = await resolveAccess(null, 'forge.high');
		expect(a.pay_per_use).toBe('forge.high');
		const b = await resolveAccess(null, 'names.first_dibs');
		expect(b.pay_per_use).toBe('name.auction');
	});
});

describe('resolveAccess — on-chain tier resolution maps held value to eligibility', () => {
	for (let level = 0; level <= 4; level++) {
		it(`holding $${USD_FOR_LEVEL[level]} (${TIER_ID_BY_LEVEL[level]}) gates every feature by its min level`, async () => {
			mockHeldUsd(USD_FOR_LEVEL[level]);
			for (const id of FEATURE_IDS) {
				const a = await resolveAccess({ wallet_address: WALLET }, id);
				expect(a.held.id).toBe(TIER_ID_BY_LEVEL[level]);
				expect(a.held.usd).toBe(USD_FOR_LEVEL[level]);
				expect(a.eligible).toBe(level >= MIN_LEVEL[id]);
				expect(a.reason).toBe(level >= MIN_LEVEL[id] ? 'eligible' : 'insufficient_tier');
			}
		});
	}

	it('rounds the held USD to cents', async () => {
		mockHeldUsd(123.456);
		const a = await resolveAccess({ wallet_address: WALLET }, 'forge.high');
		expect(a.held.usd).toBe(123.46);
	});
});

describe('resolveAccess — graceful degradation', () => {
	it('degrades a holder to Member on a balance read failure (never throws)', async () => {
		getBalances.mockRejectedValue(new Error('rpc down'));
		const a = await resolveAccess({ wallet_address: WALLET }, 'forge.high');
		expect(a.held.id).toBe('member');
		expect(a.held.usd).toBe(0);
		expect(a.eligible).toBe(false);
		expect(a.reason).toBe('insufficient_tier');
	});

	it('still throws the typed 404 for an unknown feature (bad input, not an outage)', async () => {
		await expect(resolveAccess({ wallet_address: WALLET }, 'ghost')).rejects.toMatchObject({
			status: 404,
			code: 'unknown_feature',
		});
	});
});
