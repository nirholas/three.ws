import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));

const recentClaimsMock = vi.fn();
const graduationsMock = vi.fn();
vi.mock('../api/_lib/pumpfun-mcp.js', () => ({
	pumpfunMcp: {
		recentClaims: (...a) => recentClaimsMock(...a),
		graduations: (...a) => graduationsMock(...a),
	},
	pumpfunBotEnabled: () => true,
}));

vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://test', ISSUER: 'http://test', MCP_RESOURCE: 'http://test' },
}));

const { default: handler } = await import('../api/cron/pumpfun-signals.js');

function mockRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
		},
	};
	return res;
}

describe('pumpfun-signals cron', () => {
	beforeEach(() => {
		sqlMock.mockReset();
		recentClaimsMock.mockReset();
		graduationsMock.mockReset();
		delete process.env.CRON_SECRET;
	});

	it('writes typed signals only for linked wallets', async () => {
		recentClaimsMock.mockResolvedValueOnce({
			ok: true,
			data: [
				{
					tx_signature: 'sig1',
					claimer: 'WALLET_A',
					first_time_claim: true,
					tier: 'influencer',
					github_account_age_days: 5,
				},
				{
					tx_signature: 'sig2',
					claimer: 'WALLET_UNKNOWN',
					first_time_claim: true,
				},
			],
		});
		graduationsMock.mockResolvedValueOnce({ ok: true, data: [] });

		// 1st sql: linked-wallet lookup → only WALLET_A is linked.
		sqlMock.mockResolvedValueOnce([
			{ address: 'WALLET_A', agent_asset: 'AGENT_A' },
		]);
		// Subsequent sql calls: insert returning [{id}] for each insert.
		sqlMock.mockResolvedValue([{ id: 1 }]);

		const req = { headers: {}, method: 'POST' };
		const res = mockRes();
		await handler(req, res);

		const body = JSON.parse(res.body);
		expect(body.claims).toBe(2);
		expect(body.skipped).toBeGreaterThanOrEqual(1); // WALLET_UNKNOWN skipped
		// WALLET_A: first_claim + influencer + new_account = 3 inserts
		expect(body.inserted).toBe(3);
	});

	it('rejects without cron secret when CRON_SECRET set', async () => {
		process.env.CRON_SECRET = 'topsecret';
		const req = { headers: {}, method: 'POST' };
		const res = mockRes();
		await handler(req, res);
		expect(res.statusCode).toBe(401);
	});
});
