// requireRealFundsAgreement() refuses callers in comprehensively sanctioned
// jurisdictions with HTTP 451 before it looks at any signature. An unknown
// country never blocks, and devnet stays exempt.

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';

const sqlState = { calls: [] };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		return [{ created_at: new Date(), signature_name: 'Ada', context: 'trade' }];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const { requireRealFundsAgreement, resetRealFundsAgreementCache, SANCTIONED_COUNTRIES, isSanctionedRequest } =
	await import('../api/_lib/real-funds-agreement.js');

function makeRes() {
	return {
		statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(chunk) { if (chunk !== undefined) this.body += chunk; this.writableEnded = true; },
	};
}
const reqFrom = (geo) => ({ headers: geo ? { 'x-client-geo-location': geo } : {}, url: '/api/x' });

beforeEach(() => {
	sqlState.calls = [];
	resetRealFundsAgreementCache();
});

describe('sanctions screening', () => {
	it('exports the default list', () => {
		for (const c of ['CU', 'IR', 'KP', 'SY', 'RU', 'BY']) expect(SANCTIONED_COUNTRIES.has(c)).toBe(true);
		expect(SANCTIONED_COUNTRIES.has('US')).toBe(false);
	});

	it.each(['CU', 'IR', 'KP', 'SY', 'RU', 'BY'])('refuses %s with 451 and never reads signatures', async (cc) => {
		const res = makeRes();
		const ok = await requireRealFundsAgreement(reqFrom(cc), res, { userId: 'u1', network: 'mainnet', context: 'trade' });
		expect(ok).toBe(false);
		expect(res.statusCode).toBe(451);
		expect(JSON.parse(res.body).error).toBe('region_not_supported');
		expect(sqlState.calls).toHaveLength(0);
	});

	it('refuses Crimea, Donetsk and Luhansk inside Ukraine but not the rest of Ukraine', async () => {
		expect(isSanctionedRequest(reqFrom('UA,Crimea,Simferopol'))).toBe(true);
		expect(isSanctionedRequest(reqFrom('UA,Donetsk,Donetsk'))).toBe(true);
		expect(isSanctionedRequest(reqFrom('UA,Luhansk,Luhansk'))).toBe(true);
		expect(isSanctionedRequest(reqFrom('UA,Kyiv,Kyiv'))).toBe(false);
	});

	it('does not block an unknown country or an allowed one', async () => {
		for (const geo of [null, 'ZZ9', 'US,California,Mountain View']) {
			const res = makeRes();
			const ok = await requireRealFundsAgreement(reqFrom(geo), res, { userId: 'u1', network: 'mainnet', context: 'trade' });
			expect(ok).toBe(true);
		}
	});

	it('keeps devnet exempt', async () => {
		const res = makeRes();
		expect(await requireRealFundsAgreement(reqFrom('KP'), res, { userId: 'u1', network: 'devnet' })).toBe(true);
	});

	it('honors the env override', async () => {
		process.env.REAL_FUNDS_BLOCKED_COUNTRIES = 'FR';
		try {
			expect(isSanctionedRequest(reqFrom('FR'))).toBe(true);
			expect(isSanctionedRequest(reqFrom('CU'))).toBe(false);
		} finally {
			delete process.env.REAL_FUNDS_BLOCKED_COUNTRIES;
		}
	});
});
