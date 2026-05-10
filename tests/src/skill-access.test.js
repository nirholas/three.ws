// Unit tests for the runtime skill-access checkers.
//
// `fromAgentDetail`, `remoteCheck`, and `autoBuying` decide whether a skill
// invocation is allowed. The runtime calls them in `_dispatchTool` for every
// skill-provided tool (built-ins are exempt — see runtime.test.js gate suite).

import { describe, it, expect, vi } from 'vitest';

import {
	PaymentRequiredError,
	alwaysAllow,
	fromAgentDetail,
	remoteCheck,
	autoBuying,
} from '../../src/runtime/skill-access.js';

// ── PaymentRequiredError ─────────────────────────────────────────────────────

describe('PaymentRequiredError', () => {
	it('captures the payload and exposes a `payment_required` code', () => {
		const e = new PaymentRequiredError({
			skill: 'premium',
			price: { amount: '1000000', currency_mint: 'EPjF', chain: 'solana' },
		});
		expect(e.code).toBe('payment_required');
		expect(e.payload.skill).toBe('premium');
		expect(e.payload.price.amount).toBe('1000000');
		expect(e.message).toContain('premium');
	});
});

// ── alwaysAllow ──────────────────────────────────────────────────────────────

describe('alwaysAllow', () => {
	it('returns a function that allows every skill', async () => {
		const check = alwaysAllow();
		expect(await check('any_skill')).toEqual({ allowed: true });
		expect(await check('another')).toEqual({ allowed: true });
	});
});

// ── fromAgentDetail ──────────────────────────────────────────────────────────

describe('fromAgentDetail', () => {
	const agent = {
		skill_prices: {
			premium: { amount: '1000000', currency_mint: 'EPjF', chain: 'solana' },
			plus:    { amount: '500000',  currency_mint: 'EPjF' /* defaults to solana */ },
		},
		purchased_skills: ['plus'],
	};

	it('allows free skills (not in skill_prices)', async () => {
		const check = fromAgentDetail(agent);
		expect(await check('free_skill')).toEqual({ allowed: true });
	});

	it('allows priced skills the user has purchased', async () => {
		const check = fromAgentDetail(agent);
		expect(await check('plus')).toEqual({ allowed: true });
	});

	it('denies priced skills the user has not purchased, returning price + skill name', async () => {
		const check = fromAgentDetail(agent);
		const result = await check('premium');
		expect(result.allowed).toBe(false);
		expect(result.skill).toBe('premium');
		expect(result.price).toEqual({
			amount: '1000000',
			currency_mint: 'EPjF',
			chain: 'solana',
		});
		expect(result.message).toContain('premium');
	});

	it('defaults missing chain to solana', async () => {
		const check = fromAgentDetail(agent);
		const result = await check('plus');
		expect(result).toEqual({ allowed: true }); // because purchased
		// flip purchased flag to verify chain default
		const check2 = fromAgentDetail({ ...agent, purchased_skills: [] });
		const r2 = await check2('plus');
		expect(r2.price.chain).toBe('solana');
	});

	it('handles missing skill_prices/purchased_skills gracefully', async () => {
		const empty = fromAgentDetail({});
		expect(await empty('whatever')).toEqual({ allowed: true });
	});
});

// ── remoteCheck ──────────────────────────────────────────────────────────────

describe('remoteCheck', () => {
	it('allows when /check-skill-access returns has_access: true', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ has_access: true }),
		});
		const check = remoteCheck({ agentId: 'agent-1', fetchImpl });
		expect(await check('skill-x')).toEqual({ allowed: true });

		expect(fetchImpl).toHaveBeenCalledWith(
			expect.stringContaining('agent_id=agent-1'),
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('denies with skill name + message when has_access is false', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ has_access: false }),
		});
		const check = remoteCheck({ agentId: 'agent-1', fetchImpl });
		const result = await check('skill-x');
		expect(result.allowed).toBe(false);
		expect(result.skill).toBe('skill-x');
	});

	it('fails open (allowed:true) on network error so transient issues do not block use', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('ENETUNREACH'));
		const check = remoteCheck({ agentId: 'agent-1', fetchImpl });
		expect(await check('skill-x')).toEqual({ allowed: true });
	});

	it('treats non-ok HTTP as allowed (anonymous user, skill not for sale)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
		const check = remoteCheck({ agentId: 'agent-1', fetchImpl });
		expect(await check('skill-x')).toEqual({ allowed: true });
	});
});

// ── autoBuying ───────────────────────────────────────────────────────────────

describe('autoBuying', () => {
	it('allows when buyer already owns the skill (skips purchase)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ has_access: true }),
		});
		const check = autoBuying({
			buyerAgentId: 'buyer',
			sellerAgentId: 'seller',
			fetchImpl,
		});
		expect(await check('paid_tool')).toEqual({ allowed: true });
		expect(fetchImpl).toHaveBeenCalledTimes(1); // only the access check
	});

	it('purchases via /api/marketplace/purchase-as-agent when not yet owned, then allows', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ has_access: false }) })
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: { status: 'confirmed', tx_signature: 'sig' } }),
			});
		const check = autoBuying({
			buyerAgentId: 'buyer',
			sellerAgentId: 'seller',
			fetchImpl,
		});
		const result = await check('paid_tool');
		expect(result.allowed).toBe(true);
		expect(result.autoPurchased).toBe(true);

		const [, purchaseCall] = fetchImpl.mock.calls;
		expect(purchaseCall[0]).toBe('/api/marketplace/purchase-as-agent');
		expect(purchaseCall[1].method).toBe('POST');
		const sentBody = JSON.parse(purchaseCall[1].body);
		expect(sentBody).toEqual({
			buyer_agent_id: 'buyer',
			seller_agent_id: 'seller',
			skill: 'paid_tool',
		});
	});

	it('respects already_owned response from purchase endpoint (no autoPurchased flag)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ has_access: false }) })
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: { already_owned: true, tx_signature: 'old' } }),
			});
		const check = autoBuying({
			buyerAgentId: 'buyer',
			sellerAgentId: 'seller',
			fetchImpl,
		});
		const result = await check('paid_tool');
		expect(result).toEqual({ allowed: true, autoPurchased: false });
	});

	it('denies with descriptive message when purchase endpoint returns an error', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ has_access: false }) })
			.mockResolvedValueOnce({
				ok: false,
				status: 412,
				json: async () => ({
					error: 'no_buyer_wallet',
					error_description: 'buyer agent has no Solana wallet',
				}),
			});
		const check = autoBuying({
			buyerAgentId: 'buyer',
			sellerAgentId: 'seller',
			fetchImpl,
		});
		const result = await check('paid_tool');
		expect(result.allowed).toBe(false);
		expect(result.skill).toBe('paid_tool');
		expect(result.message).toContain('buyer agent has no Solana wallet');
	});

	it('denies when purchase endpoint succeeds but status is not confirmed', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ has_access: false }) })
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: { status: 'pending' } }),
			});
		const check = autoBuying({
			buyerAgentId: 'buyer',
			sellerAgentId: 'seller',
			fetchImpl,
		});
		const result = await check('paid_tool');
		expect(result.allowed).toBe(false);
	});
});
