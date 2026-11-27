// The Robinhood Crypto connector must hold the same real-funds agreement gate
// as every other money path: placing an order and switching trading on both
// refuse an account that has not signed, before any database or venue call.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || 'r'.repeat(64);

const state = { signed: false, sqlCalls: 0, sanctioned: false };

vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(
		() => {
			state.sqlCalls += 1;
			return Promise.resolve([]);
		},
		{ transaction: async () => [] },
	),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/real-funds-agreement.js', async () => {
	const actual = await vi.importActual('../api/_lib/real-funds-agreement.js');
	return {
		...actual,
		hasCurrentAgreement: async () => state.signed,
		isSanctionedRequest: () => state.sanctioned,
	};
});

const svc = await import('../api/_lib/robinhood/service.js');
const USER = '77777777-7777-4777-8777-777777777777';
const PREVIEW = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
	state.signed = false;
	state.sqlCalls = 0;
	state.sanctioned = false;
});

describe('robinhood real-funds agreement gate', () => {
	it('refuses placeOrder for an unsigned account before touching the database', async () => {
		await expect(svc.placeOrder({ userId: USER, previewId: PREVIEW, confirmOrder: true })).rejects.toMatchObject({
			status: 403,
			code: 'risk_ack_required',
		});
		expect(state.sqlCalls).toBe(0);
	});

	it('refuses switching trading on for an unsigned account', async () => {
		await expect(svc.updateSettings({ userId: USER, tradingEnabled: true })).rejects.toMatchObject({
			status: 403,
			code: 'risk_ack_required',
		});
		expect(state.sqlCalls).toBe(0);
	});

	it('does not gate pausing trading or changing caps', async () => {
		await expect(svc.updateSettings({ userId: USER, tradingEnabled: false })).rejects.toMatchObject({ code: 'not_connected' });
	});

	it('lets a signed account reach the order lookup', async () => {
		state.signed = true;
		await expect(svc.placeOrder({ userId: USER, previewId: PREVIEW, confirmOrder: true })).rejects.toMatchObject({ code: 'preview_not_found' });
	});

	it('refuses a sanctioned region with 451 even when signed', async () => {
		state.signed = true;
		state.sanctioned = true;
		await expect(svc.placeOrder({ userId: USER, previewId: PREVIEW, confirmOrder: true, req: {} })).rejects.toMatchObject({
			status: 451,
			code: 'region_not_supported',
		});
	});
});
