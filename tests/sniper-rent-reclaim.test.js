import { describe, it, expect } from 'vitest';
import { planCloses, MAX_CLOSES_PER_TX } from '../workers/agent-sniper/rent-reclaim.js';
import { TOKEN_PROGRAMS } from '../workers/agent-sniper/reconcile.js';

const [TOKEN, TOKEN_2022] = TOKEN_PROGRAMS;
const acct = (n, amount, programId = TOKEN_2022, lamports = 2_039_280) => ({ pubkey: `acct${n}`, programId, amount, lamports });

describe('planCloses', () => {
	it('closes only accounts whose raw balance is exactly zero', () => {
		const plan = planCloses([acct(1, '0'), acct(2, '1'), acct(3, '0', TOKEN), acct(4, 0n)]);
		expect(plan.closable).toBe(3);
		expect(plan.batches.flat().map((a) => a.pubkey)).toEqual(['acct1', 'acct3', 'acct4']);
		expect(plan.rentLamports).toBe(3 * 2_039_280);
	});

	it('never treats an unreadable balance as empty', () => {
		const plan = planCloses([acct(1, null), acct(2, undefined), acct(3, 'not-a-number')]);
		expect(plan.closable).toBe(0);
		expect(plan.batches).toEqual([]);
	});

	it('ignores accounts owned by any program other than the two token programs', () => {
		const plan = planCloses([acct(1, '0', '11111111111111111111111111111111')]);
		expect(plan.closable).toBe(0);
	});

	it('batches so no transaction carries more than the per-tx cap', () => {
		const many = Array.from({ length: MAX_CLOSES_PER_TX * 2 + 3 }, (_, i) => acct(i, '0'));
		const plan = planCloses(many);
		expect(plan.batches.map((b) => b.length)).toEqual([MAX_CLOSES_PER_TX, MAX_CLOSES_PER_TX, 3]);
	});

	it('returns an empty plan for empty or missing input', () => {
		expect(planCloses([]).closable).toBe(0);
		expect(planCloses(null).closable).toBe(0);
	});
});
