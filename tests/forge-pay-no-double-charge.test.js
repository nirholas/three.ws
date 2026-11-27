// @vitest-environment jsdom
//
// The Forge pay sheet (src/forge-pay.js and its Studio copy) must never make a
// user pay twice for one thing (order 129). Three paths did:
//   1. Closing the sheet (Escape, the X, the backdrop) during the short success
//      display resolved { ok:false, cancelled:true } after the payment settled,
//      so the caller said "No $THREE was spent" and dropped the proof.
//   2. A payment that was sent on-chain but whose settle call failed or never
//      answered (paid:true) offered "Try again", which ran a brand new quote and
//      a second transfer. It now re-checks the SAME transaction instead.
//   3. A settled proof lived only in memory. A reload, or a follow-up request
//      that failed after the payment, lost it and the next click charged again.
//      An unspent proof is now remembered for the server's redemption window and
//      reused once, until the caller reports it spent.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rail = vi.hoisted(() => ({ payCalls: 0, settleCalls: [], payResult: null, payError: null, settleResult: null }));

vi.mock('../src/token-pay.js', () => ({
	fetchTokenConfig: async () => ({
		treasury_configured: true,
		rewards_configured: true,
		split_policies: { consumption: [{ role: 'treasury', bps: 7000 }, { role: 'rewards', bps: 3000 }] },
	}),
	payWithToken: async () => {
		rail.payCalls += 1;
		if (rail.payError) throw rail.payError;
		return rail.payResult;
	},
	settleTokenPayment: async (args) => {
		rail.settleCalls.push(args);
		if (rail.settleResult instanceof Error) throw rail.settleResult;
		return rail.settleResult;
	},
}));
vi.mock('../src/shared/risk-ack.js', () => ({ ensureRiskAck: async () => true }));
vi.mock('../src/shared/native-handoff.js', () => ({ leaveAppForPayment: () => false }));

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(fn) {
	for (let i = 0; i < 100; i++) {
		const v = fn();
		if (v) return v;
		await tick();
	}
	throw new Error('condition not reached');
}
const payButton = () => document.querySelector('[data-fpay-pay]');
const retryButton = () => document.querySelector('[data-fpay-retry]');
const okStatus = () => document.querySelector('.fpay-status--ok');
const errTitle = () => document.querySelector('.fpay-err-title')?.textContent || '';
// A closed sheet stays in the DOM for its exit transition; wait it out so the
// next lookup finds the new sheet, not the old one's buttons.
async function gone() {
	for (let i = 0; i < 100 && document.querySelector('.fpay-overlay'); i++) await new Promise((r) => setTimeout(r, 20));
	expect(document.querySelector('.fpay-overlay')).toBeNull();
}

describe.each([
	['src/forge-pay.js', () => import('../src/forge-pay.js')],
	['src/forge-studio/forge-pay.js', () => import('../src/forge-studio/forge-pay.js')],
])('%s never charges twice', (_name, load) => {
	beforeEach(() => {
		document.body.innerHTML = '';
		localStorage.clear();
		rail.payCalls = 0;
		rail.settleCalls = [];
		rail.payError = null;
		rail.payResult = { ok: true, payment_id: '0d6f2c1a-5b7e-4c3d-9a8b-1f2e3d4c5b6a' };
		rail.settleResult = null;
		if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
	});

	it('hands back the settled proof when the sheet is closed during the success display', async () => {
		const { payForConsumption } = await load();
		const result = payForConsumption({ usd: 0.15, refPrefix: 'forge-keep' });
		(await until(payButton)).click();
		await until(okStatus);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		const out = await result;
		expect(out.ok).toBe(true);
		expect(out.paymentId).toBe('0d6f2c1a-5b7e-4c3d-9a8b-1f2e3d4c5b6a');
		expect(out.refId).toMatch(/^forge-keep-/);
	});

	it('re-checks the same transaction after a sent-but-unverified payment instead of paying again', async () => {
		const { payForConsumption } = await load();
		rail.payError = Object.assign(new Error('Payment sent but confirmation could not be reached.'), {
			code: 'settle_unreachable',
			paid: true,
			tx_signature: 'sig-sent-once',
			quote_token: 'quote-token-1',
			network: 'mainnet',
		});
		const result = payForConsumption({ usd: 0.5, refPrefix: 'forge-high' });
		(await until(payButton)).click();
		await until(retryButton);
		expect(errTitle()).toMatch(/sent/i);
		expect(document.body.textContent).not.toMatch(/no \$THREE was spent/i);
		rail.settleResult = { ok: true, payment_id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' };
		retryButton().click();
		const out = await result;
		expect(rail.payCalls).toBe(1);
		expect(rail.settleCalls).toEqual([{ quoteToken: 'quote-token-1', txSignature: 'sig-sent-once', network: 'mainnet' }]);
		expect(out).toMatchObject({ ok: true, paymentId: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' });
	});

	it('reuses an unspent settled proof instead of charging again, until it is reported spent', async () => {
		const mod = await load();
		const first = mod.payForConsumption({ usd: 0.15, refPrefix: 'forge-keep' });
		(await until(payButton)).click();
		const paid = await first;
		expect(rail.payCalls).toBe(1);
		await gone();

		// Same action and price: the follow-up request failed, so the next click
		// presents the same proof and no sheet opens.
		const again = await mod.payForConsumption({ usd: 0.15, refPrefix: 'forge-keep' });
		expect(again).toMatchObject({ ok: true, paymentId: paid.paymentId, refId: paid.refId, reused: true });
		expect(rail.payCalls).toBe(1);
		expect(document.querySelector('.fpay-overlay')).toBeNull();

		// A different action or price never borrows it.
		const other = mod.payForConsumption({ usd: 0.5, refPrefix: 'forge-high' });
		await until(payButton);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect((await other).ok).toBe(false);
		await gone();

		// Once the server took it, it is gone and the next one is a fresh payment.
		mod.forgetPaidProof(paid.paymentId);
		rail.payResult = { ok: true, payment_id: '1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a0b' };
		const fresh = mod.payForConsumption({ usd: 0.15, refPrefix: 'forge-keep' });
		(await until(payButton)).click();
		expect((await fresh).paymentId).toBe('1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a0b');
		expect(rail.payCalls).toBe(2);
	});

	it('does not reuse a proof older than the redemption window', async () => {
		const mod = await load();
		const first = mod.payForConsumption({ usd: 0.15, refPrefix: 'forge-keep' });
		(await until(payButton)).click();
		await first;
		await gone();
		const realNow = Date.now;
		Date.now = () => realNow() + 24 * 60 * 60 * 1000;
		try {
			const later = mod.payForConsumption({ usd: 0.15, refPrefix: 'forge-keep' });
			await until(payButton);
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
			expect((await later).ok).toBe(false);
		} finally {
			Date.now = realNow;
		}
	});
});
