import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
	eligibleHolders, splitProRata, drawLottery, lotterySeed, tokenDeltaFromMeta, lamportsToSolString, rawToUi,
	MIN_REWARD_LAMPORTS,
} from '../api/_lib/coin-control/core.js';
import { normalizeRule, ruleHash, planRun, LEG_KINDS } from '../api/_lib/revenue-ledger-core.js';

const W = (n) => `Wallet${String(n).padStart(3, '0')}`;
const holders = (amounts) => amounts.map((amount, i) => ({ owner: W(i), amount }));
const sum = (rows) => rows.reduce((a, r) => a + r.lamports, 0n);

describe('eligibleHolders', () => {
	it('drops excluded wallets, program owners, empty balances and rows with no owner', () => {
		const rows = [
			{ owner: 'Agent', amount: 900 },
			{ owner: 'CurvePda', amount: 800 },
			{ owner: W(1), amount: 500 },
			{ owner: W(2), amount: 0 },
			{ owner: null, amount: 400 },
			{ owner: W(3), amount: 100 },
		];
		const out = eligibleHolders(rows, { exclude: ['Agent', null], isWallet: (o) => o !== 'CurvePda' });
		expect(out.map((h) => h.owner)).toEqual([W(1), W(3)]);
	});
});

describe('splitProRata', () => {
	it('splits by balance and the shares sum to the pot exactly', () => {
		const out = splitProRata(holders([600, 300, 100]), 1_000_000_000n, 3);
		expect(out.map((r) => r.lamports)).toEqual([600_000_000n, 300_000_000n, 100_000_000n]);
		expect(sum(out)).toBe(1_000_000_000n);
	});

	it('gives rounding dust to the largest holder', () => {
		const out = splitProRata(holders([1, 1, 1]), 10_000_001n, 3);
		expect(sum(out)).toBe(10_000_001n);
		expect(out[0].lamports).toBe(3_333_335n);
	});

	it('drops holders whose share would fall under the minimum, then re-splits', () => {
		// 0.01 SOL across 1000:1: the small holder would get ~0.00001 SOL.
		const out = splitProRata(holders([1000, 1]), 10_000_000n, 2);
		expect(out).toHaveLength(1);
		expect(out[0].lamports).toBe(10_000_000n);
	});

	it('pays nobody when the pot cannot reach the minimum', () => {
		expect(splitProRata(holders([5]), MIN_REWARD_LAMPORTS - 1n, 1)).toEqual([]);
	});

	it('only considers the top `count` holders', () => {
		expect(splitProRata(holders([5, 4, 3, 2]), 1_000_000_000n, 2).map((r) => r.owner)).toEqual([W(0), W(1)]);
	});
});

describe('lottery', () => {
	const pool = holders([500, 300, 150, 50]);
	const seed = lotterySeed('leg:abc', 'Blockhash111');

	it('derives the seed from the leg key and blockhash, so anyone can recompute it', () => {
		expect(seed).toBe(createHash('sha256').update('leg:abc|Blockhash111').digest('hex'));
		expect(lotterySeed('leg:abc', 'Other')).not.toBe(seed);
	});

	it('is deterministic for a seed and draws without replacement', () => {
		const a = drawLottery(pool, 3_000_000_000n, 3, seed);
		const b = drawLottery(pool, 3_000_000_000n, 3, seed);
		expect(a.map((w) => w.owner)).toEqual(b.map((w) => w.owner));
		expect(new Set(a.map((w) => w.owner)).size).toBe(3);
	});

	it('splits the pot equally with the remainder to the first winner', () => {
		const out = drawLottery(pool, 1_000_000_001n, 3, seed);
		expect(sum(out)).toBe(1_000_000_001n);
		expect(out[1].lamports).toBe(333_333_333n);
		expect(out[0].lamports).toBe(333_333_335n);
	});

	it('draws fewer winners when the pot cannot pay each the minimum', () => {
		expect(drawLottery(pool, MIN_REWARD_LAMPORTS * 2n, 3, seed)).toHaveLength(2);
		expect(drawLottery(pool, MIN_REWARD_LAMPORTS - 1n, 3, seed)).toEqual([]);
	});

	it('weights the draw by balance', () => {
		const wins = new Map();
		for (let i = 0; i < 2000; i++) {
			const [w] = drawLottery(holders([900, 100]), 10_000_000n, 1, lotterySeed(`leg:${i}`, 'bh'));
			wins.set(w.owner, (wins.get(w.owner) || 0) + 1);
		}
		const share = wins.get(W(0)) / 2000;
		expect(share).toBeGreaterThan(0.85);
		expect(share).toBeLessThan(0.95);
	});
});

describe('tokenDeltaFromMeta', () => {
	const mint = 'MintAAA';
	it('reads what the owner gained from pre/post balances', () => {
		const meta = {
			preTokenBalances: [{ mint, owner: 'Agent', uiTokenAmount: { amount: '100' } }],
			postTokenBalances: [
				{ mint, owner: 'Agent', uiTokenAmount: { amount: '1500' } },
				{ mint, owner: 'Curve', uiTokenAmount: { amount: '9' } },
				{ mint: 'Other', owner: 'Agent', uiTokenAmount: { amount: '77' } },
			],
		};
		expect(tokenDeltaFromMeta(meta, 'Agent', mint)).toBe(1400n);
	});

	it('counts a freshly opened token account (no pre balance) and never goes negative', () => {
		expect(tokenDeltaFromMeta({ preTokenBalances: [], postTokenBalances: [{ mint, owner: 'Agent', uiTokenAmount: { amount: '42' } }] }, 'Agent', mint)).toBe(42n);
		expect(tokenDeltaFromMeta({ preTokenBalances: [{ mint, owner: 'Agent', uiTokenAmount: { amount: '42' } }], postTokenBalances: [] }, 'Agent', mint)).toBe(0n);
		expect(tokenDeltaFromMeta(null, 'Agent', mint)).toBe(0n);
	});
});

describe('formatting', () => {
	it('prints lamports and raw token units exactly', () => {
		expect(lamportsToSolString(1_500_000_000n)).toBe('1.5');
		expect(lamportsToSolString(1_000_000n)).toBe('0.001');
		expect(lamportsToSolString(0n)).toBe('0');
		expect(rawToUi('123456789', 6)).toBe('123.456789');
		expect(rawToUi('1000000', 6)).toBe('1');
		expect(rawToUi('5', 0)).toBe('5');
	});
});

describe('engine legs in a rule', () => {
	const base = { per_run_cap_usd: 50, lifetime_cap_usd: 500, period: 'weekly' };

	it('accepts buyback and burn and holder rewards with their defaults', () => {
		expect(LEG_KINDS).toEqual(expect.arrayContaining(['buyback_burn', 'holder_rewards']));
		const r = normalizeRule({ ...base, legs: [{ kind: 'buyback_burn', pct: 30 }, { kind: 'holder_rewards', pct: 20 }] });
		expect(r.legs).toEqual([
			{ kind: 'buyback_burn', pct: 30 },
			{ kind: 'holder_rewards', pct: 20, mode: 'pro_rata', recipients: 10 },
		]);
		const lot = normalizeRule({ ...base, legs: [{ kind: 'holder_rewards', pct: 10, mode: 'lottery' }] });
		expect(lot.legs[0]).toEqual({ kind: 'holder_rewards', pct: 10, mode: 'lottery', recipients: 3 });
	});

	it('refuses a bad mode or recipient count', () => {
		expect(() => normalizeRule({ ...base, legs: [{ kind: 'holder_rewards', pct: 10, mode: 'raffle' }] })).toThrow(/pro_rata or lottery/);
		expect(() => normalizeRule({ ...base, legs: [{ kind: 'holder_rewards', pct: 10, recipients: 21 }] })).toThrow(/between 1 and 20/);
		expect(() => normalizeRule({ ...base, legs: [{ kind: 'holder_rewards', pct: 10, recipients: 0 }] })).toThrow(/between 1 and 20/);
	});

	it('plans the new legs under the same caps', () => {
		const r = normalizeRule({ ...base, legs: [{ kind: 'buyback_burn', pct: 50 }, { kind: 'holder_rewards', pct: 50 }] });
		const plan = planRun({ baseUsd: 1000, legs: r.legs, perRunCapUsd: 50, lifetimeCapUsd: 500, lifetimeSpentUsd: 0, minRunUsd: 1 });
		expect(plan.legs.reduce((a, l) => a + l.capped_usd, 0)).toBeCloseTo(50, 6);
	});

	it('keeps the hash of a rule confirmed before leg options existed', () => {
		const rule = { agent_id: 'a', network: 'mainnet', period: 'weekly', basis: 'revenue', per_run_cap_usd: 10, lifetime_cap_usd: 100, min_run_usd: 1, legs: [{ kind: 'model_credits', pct: 20 }, { kind: 'dca_own_coin', pct: 10 }] };
		const legacy = createHash('sha256').update(JSON.stringify({
			agent_id: 'a', network: 'mainnet', period: 'weekly', basis: 'revenue', per_run_cap_usd: 10, lifetime_cap_usd: 100, min_run_usd: 1,
			legs: [{ kind: 'dca_own_coin', pct: 10, session_id: null }, { kind: 'model_credits', pct: 20, session_id: null }],
		})).digest('hex');
		expect(ruleHash(rule)).toBe(legacy);
	});

	it('changes the hash when the reward mode or recipient count changes', () => {
		const rule = (leg) => ({ agent_id: 'a', network: 'mainnet', period: 'weekly', basis: 'revenue', per_run_cap_usd: 10, lifetime_cap_usd: 100, min_run_usd: 1, legs: [leg] });
		const a = ruleHash(rule({ kind: 'holder_rewards', pct: 10, mode: 'pro_rata', recipients: 10 }));
		expect(ruleHash(rule({ kind: 'holder_rewards', pct: 10, mode: 'lottery', recipients: 10 }))).not.toBe(a);
		expect(ruleHash(rule({ kind: 'holder_rewards', pct: 10, mode: 'pro_rata', recipients: 5 }))).not.toBe(a);
	});
});
