// @vitest-environment jsdom
//
// The Forge pay sheet must show who is paid, how much and in which token before
// the wallet is asked to sign (order 129), and must offer no way to pay when the
// rail cannot route. The recipients come from /api/token/config: the same
// treasury and rewards addresses the quote's legs pay. Both copies pinned.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rail = vi.hoisted(() => ({ cfg: null }));
vi.mock('../src/token-pay.js', () => ({
	fetchTokenConfig: async () => rail.cfg,
	payWithToken: async () => {
		throw new Error('the test never pays');
	},
	settleTokenPayment: async () => {
		throw new Error('the test never settles');
	},
}));
vi.mock('../src/shared/risk-ack.js', () => ({ ensureRiskAck: async () => true }));
vi.mock('../src/shared/native-handoff.js', () => ({ leaveAppForPayment: () => false }));

const TREASURY = 'THREEsynthetic1111111111111111111111111111';
const REWARDS = 'THREEsyntheticRewards11111111111111111111';
const CONFIGURED = {
	mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
	symbol: '$THREE',
	treasury: TREASURY,
	treasury_configured: true,
	rewards_wallet: REWARDS,
	rewards_configured: true,
	split_policies: { consumption: [{ role: 'treasury', bps: 7000 }, { role: 'rewards', bps: 3000 }] },
};

async function until(fn) {
	for (let i = 0; i < 100; i++) {
		const v = fn();
		if (v) return v;
		await new Promise((r) => setTimeout(r, 0));
	}
	throw new Error('condition not reached');
}
const payButton = () => document.querySelector('[data-fpay-pay]');

describe.each([
	['src/forge-pay.js', () => import('../src/forge-pay.js')],
	['src/forge-studio/forge-pay.js', () => import('../src/forge-studio/forge-pay.js')],
])('%s confirm step', (_name, load) => {
	beforeEach(() => {
		document.body.innerHTML = '';
		localStorage.clear();
		if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
	});

	it('names every recipient, its share and the token before the Pay button', async () => {
		rail.cfg = CONFIGURED;
		const { payForConsumption } = await load();
		payForConsumption({ usd: 0.5, refPrefix: 'forge-high' });
		await until(payButton);
		const to = document.querySelector('.fpay-to');
		expect(to).not.toBeNull();
		const text = to.textContent;
		expect(text).toMatch(/treasury/i);
		expect(text).toMatch(/70%/);
		expect(text).toMatch(/rewards/i);
		expect(text).toMatch(/30%/);
		expect(text).toContain(`${TREASURY.slice(0, 4)}…${TREASURY.slice(-4)}`);
		expect(text).toContain(`${REWARDS.slice(0, 4)}…${REWARDS.slice(-4)}`);
		expect(to.querySelector(`[title="${TREASURY}"]`)).not.toBeNull();
		expect(document.querySelector('.fpay-price').textContent).toMatch(/\$0\.50[\s\S]*\$THREE/);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
	});

	it('offers no way to pay when the rail cannot route, and says nothing was charged', async () => {
		rail.cfg = { ...CONFIGURED, treasury: null, treasury_configured: false };
		const { payForConsumption } = await load();
		const out = payForConsumption({ usd: 0.5, refPrefix: 'forge-high' });
		await until(() => document.querySelector('.fpay-err-title'));
		expect(payButton()).toBeNull();
		expect(document.body.textContent).toMatch(/nothing was charged/i);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect((await out).ok).toBe(false);
	});
});
