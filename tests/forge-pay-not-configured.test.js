// @vitest-environment jsdom
//
// The Forge pay sheet (src/forge-pay.js and its Studio copy) treated
// treasury_unavailable / rewards_unavailable, the production state on
// 2026-11-04 where THREE_TREASURY_WALLET and THREE_REWARDS_WALLET are unset, as
// "Payments briefly unavailable ... Try again in a moment" with a retry button.
// No retry can succeed until an operator sets the wallets, so holders were sent
// round a loop that could not end. The sheet now reads /api/token/config first
// and, when a wallet the consumption split pays is unset, says the rail is not
// switched on yet before any risk prompt or Pay button; a not-configured answer
// from the quote itself renders the same state with no retry. Transient codes
// (price feed) keep their retry.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const tokenPay = vi.hoisted(() => ({ config: null, configError: null, payError: null, payCalls: 0 }));
const riskAck = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../src/token-pay.js', () => ({
	fetchTokenConfig: async () => {
		if (tokenPay.configError) throw tokenPay.configError;
		return tokenPay.config;
	},
	payWithToken: async () => {
		tokenPay.payCalls += 1;
		if (tokenPay.payError) throw tokenPay.payError;
		return { ok: true, payment_id: 'pay-1' };
	},
}));

vi.mock('../src/shared/risk-ack.js', () => ({
	ensureRiskAck: async () => {
		riskAck.calls += 1;
		return true;
	},
}));

vi.mock('../src/shared/native-handoff.js', () => ({ leaveAppForPayment: () => false }));

const CONSUMPTION = [
	{ role: 'treasury', bps: 7000 },
	{ role: 'rewards', bps: 3000 },
];

function config({ treasury = true, rewards = true } = {}) {
	return {
		treasury_configured: treasury,
		rewards_configured: rewards,
		split_policies: { consumption: CONSUMPTION },
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function until(fn) {
	for (let i = 0; i < 50; i++) {
		const v = fn();
		if (v) return v;
		await tick();
	}
	throw new Error('condition not reached');
}

const sheet = () => document.querySelector('.fpay-modal');
const payButton = () => document.querySelector('[data-fpay-pay]');
const retryButton = () => document.querySelector('[data-fpay-retry]');
const errTitle = () => document.querySelector('.fpay-err-title')?.textContent || '';

describe.each([
	['src/forge-pay.js', () => import('../src/forge-pay.js')],
	['src/forge-studio/forge-pay.js', () => import('../src/forge-studio/forge-pay.js')],
])('%s when the $THREE rail is not configured', (_name, load) => {
	beforeEach(() => {
		document.body.innerHTML = '';
		tokenPay.config = config();
		tokenPay.configError = null;
		tokenPay.payError = null;
		tokenPay.payCalls = 0;
		riskAck.calls = 0;
		if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
	});

	afterEach(() => {
		document.querySelector('[data-fpay-cancel]')?.click();
	});

	it('says it is not switched on yet, with no Pay button or risk prompt, when the treasury is unset', async () => {
		tokenPay.config = config({ treasury: false });
		const { payForConsumption } = await load();
		const result = payForConsumption({ usd: 0.5 });
		await until(sheet);
		expect(errTitle()).toBe('Not switched on yet');
		expect(sheet().textContent).toMatch(/nothing was charged/i);
		expect(sheet().textContent).not.toMatch(/briefly|try again/i);
		expect(payButton()).toBeNull();
		expect(retryButton()).toBeNull();
		expect(riskAck.calls).toBe(0);
		document.querySelector('[data-fpay-cancel]').click();
		await expect(result).resolves.toEqual({ ok: false, cancelled: true });
		expect(tokenPay.payCalls).toBe(0);
	});

	it('says the same when only the holder-rewards wallet is unset', async () => {
		tokenPay.config = config({ rewards: false });
		const { payForConsumption } = await load();
		payForConsumption({ usd: 0.5 });
		await until(sheet);
		expect(errTitle()).toBe('Not switched on yet');
		expect(payButton()).toBeNull();
	});

	it('renders the not-configured state with no retry when the quote answers treasury_unavailable', async () => {
		tokenPay.payError = Object.assign(new Error('Paying in $THREE is not switched on yet, so nothing was charged.'), {
			code: 'treasury_unavailable',
		});
		const { payForConsumption } = await load();
		payForConsumption({ usd: 0.5 });
		(await until(payButton)).click();
		await until(errTitle);
		expect(errTitle()).toBe('Not switched on yet');
		expect(retryButton()).toBeNull();
	});

	it('offers the normal Pay button when the config read fails, leaving the quote as the authority', async () => {
		tokenPay.configError = new Error('token config 502');
		const { payForConsumption } = await load();
		payForConsumption({ usd: 0.5 });
		expect((await until(payButton)).textContent).toBe('Pay $0.50');
	});

	it('keeps the retry for a transient price feed outage', async () => {
		tokenPay.payError = Object.assign(new Error('price feed down'), { code: 'price_unavailable' });
		const { payForConsumption } = await load();
		payForConsumption({ usd: 0.5 });
		(await until(payButton)).click();
		await until(errTitle);
		expect(errTitle()).toBe('Price feed unavailable');
		expect(retryButton()).not.toBeNull();
	});
});
