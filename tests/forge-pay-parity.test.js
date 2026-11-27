// @vitest-environment jsdom
//
// /forge and Forge Studio each carried a copy of the $THREE pay sheet, and each
// copy had a safeguard the other lacked:
//   - Studio's copy handed the payment to Safari inside the three.ws iOS app
//     (App Review 3.1.1, see src/shared/native-handoff.js); /forge opened the
//     in-app sheet anyway.
//   - /forge's copy asked for the real-funds risk acknowledgment before the
//     sheet opened; Studio opened the sheet first and only asked once the
//     holder had already pressed Pay.
// Both pages now run one module, and both safeguards hold on both URLs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const state = vi.hoisted(() => ({ ack: true, ackCalls: 0, configCalls: 0, payCalls: 0 }));

vi.mock('../src/token-pay.js', () => ({
	fetchTokenConfig: async () => {
		state.configCalls += 1;
		return {
			treasury_configured: true,
			rewards_configured: true,
			split_policies: { consumption: [{ role: 'treasury', bps: 7000 }, { role: 'rewards', bps: 3000 }] },
		};
	},
	payWithToken: async () => {
		state.payCalls += 1;
		return { ok: true, payment_id: 'pay-1' };
	},
	settleTokenPayment: async () => ({ ok: true }),
}));

vi.mock('../src/shared/risk-ack.js', () => ({
	ensureRiskAck: async () => {
		state.ackCalls += 1;
		return state.ack;
	},
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
const sheet = () => document.querySelector('.fpay-modal');

// A copy that skips a safeguard opens the sheet and waits for a click that never
// comes, so give the call a short deadline instead of letting the test hang.
const settleSoon = (p) =>
	Promise.race([p, new Promise((r) => setTimeout(() => r({ pending: true, sheetOpen: !!sheet() }), 300))]);

describe.each([
	['src/forge-pay.js', () => import('../src/forge-pay.js')],
	['src/forge-studio/forge-pay.js', () => import('../src/forge-studio/forge-pay.js')],
])('%s safeguards', (_name, load) => {
	beforeEach(() => {
		document.body.innerHTML = '';
		localStorage.clear();
		Object.assign(state, { ack: true, ackCalls: 0, configCalls: 0, payCalls: 0 });
		delete globalThis.threeWsNative;
		if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
	});

	afterEach(() => {
		document.querySelector('[data-fpay-cancel]')?.click();
		delete globalThis.threeWsNative;
	});

	it('hands the payment to Safari inside the iOS app and opens no in-app sheet', async () => {
		const requireSafari = vi.fn(() => true);
		globalThis.threeWsNative = { requireSafari };
		const { payForConsumption } = await load();
		const result = await settleSoon(payForConsumption({ usd: 0.5, refPrefix: 'parity-ios' }));
		expect(result).toEqual({ ok: false, cancelled: true });
		expect(requireSafari).toHaveBeenCalledTimes(1);
		await tick();
		expect(sheet()).toBeNull();
		expect(state.payCalls).toBe(0);
	});

	it('asks for the real-funds acknowledgment before the sheet opens, and stops when it is declined', async () => {
		state.ack = false;
		const { payForConsumption } = await load();
		const result = await settleSoon(payForConsumption({ usd: 0.5, refPrefix: 'parity-ack' }));
		expect(result).toEqual({ ok: false, cancelled: true });
		expect(state.ackCalls).toBe(1);
		await tick();
		expect(sheet()).toBeNull();
		expect(state.payCalls).toBe(0);
	});
});
