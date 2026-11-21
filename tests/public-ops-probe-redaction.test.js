// Two public, key-free status endpoints echoed raw internal error text:
//   - /api/fresh-workers returned each wallet's `error` column verbatim, which
//     carries the upstream RPC URL ("solana rpc 429 @ https://<provider>/..."),
//     and some providers put the API key in that URL.
//   - /api/x402-status returned raw DB driver messages (probeSiwx, settlement
//     stats) and the ring config findings, which name the signing secrets that
//     are missing from the deploy.
// Public callers now get the failure code only; the operator (authorizeOps) still
// gets the full detail. /api/x402-status also probes every facilitator over the
// network on each call, so it is rate limited per IP before that fan-out.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from './_helpers/monetization.js';

const RPC_ERR = 'fund_failed:solana rpc 429 @ https://rpc.example/?api-key=SECRETKEY123';
let opsOk = false;
let rateOk = true;
const probeFacilitators = vi.fn(async () => []);

vi.mock('../api/_lib/ops-auth.js', () => ({ authorizeOps: vi.fn(async () => ({ ok: opsOk, actor: opsOk ? 'ops-secret' : '' })) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const text = strings.join('?');
		if (/x402_fresh_wallets/.test(text)) return [{ id: 1, pubkey: 'Pk', state: 'failed', error: RPC_ERR, amount_atomic: 0 }];
		throw new Error('relation "siwx_payments" does not exist at db-host-internal:5432');
	}),
	isDbUnavailableError: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => {
	const check = async () => ({ success: rateOk, reset: Date.now() + 1000, limit: 100, remaining: rateOk ? 99 : 0 });
	return { limits: new Proxy({}, { get: () => check }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/cache.js', () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => {}) }));
vi.mock('../api/_lib/x402/fresh-workers/wallets.js', () => ({ laneStats: vi.fn(async () => ({})) }));
vi.mock('../api/_lib/x402/fresh-workers/plan.js', () => ({
	freshWorkersConfig: () => ({ enabled: true, perTick: 1, forgeEveryNTicks: 1, dailyCapAtomic: 0 }),
}));
vi.mock('../api/_lib/x402-spec.js', () => ({
	EIP2612_EXTENSION_KEY: 'eip2612GasSponsoring',
	ERC20_APPROVAL_EXTENSION_KEY: 'erc20ApprovalGasSponsoring',
	declareEip2612GasSponsoringExtension: () => ({}),
	declareErc20ApprovalGasSponsoringExtension: () => ({}),
	paymentRequirements: () => [],
	probeFacilitators: (...a) => probeFacilitators(...a),
	X402_VERSION: 2,
}));
vi.mock('../api/_lib/siwx-server.js', () => ({ hasEvmVerifier: () => false }));
vi.mock('../api/_lib/x402/ring-config.js', async (importOriginal) => ({
	...(await importOriginal()),
	selfFacilitatorEnabled: () => true,
	selfFacilitatorUrl: () => 'https://three.ws/api/x402-facilitator',
	validateRingConfig: () => [
		{ code: 'treasury_secret_missing', severity: 'warn', message: 'X402_TREASURY_SECRET_BASE58 is not set', fix: 'set it' },
	],
}));
vi.mock('../api/_lib/x402/pending-settlements.js', () => ({
	pendingSettlementStats: vi.fn(async () => {
		throw new Error('connect ECONNREFUSED 10.8.0.3:5432');
	}),
}));

beforeEach(() => {
	opsOk = false;
	rateOk = true;
	probeFacilitators.mockClear();
});

describe('ringConfigWarningsView (shared by /api/x402-status and /api/x402-ring)', () => {
	const findings = [{ code: 'fee_payer_secret_missing', severity: 'error', message: 'X402_FEE_PAYER_SECRET_BASE58 is not set' }];

	it('gives the public a count only', async () => {
		const { ringConfigWarningsView } = await import('../api/_lib/x402/ring-config.js');
		expect(ringConfigWarningsView(findings, { operator: false })).toEqual({ config_warning_count: 1 });
		expect(ringConfigWarningsView([], {})).toEqual({ config_warning_count: 0 });
	});

	it('gives the operator the findings', async () => {
		const { ringConfigWarningsView } = await import('../api/_lib/x402/ring-config.js');
		expect(ringConfigWarningsView(findings, { operator: true })).toEqual({ config_warning_count: 1, config_warnings: findings });
	});
});

describe('/api/fresh-workers', () => {
	it('publishes the failure code, never the raw upstream error', async () => {
		const { default: handler } = await import('../api/fresh-workers.js');
		const r = await invoke(handler, { method: 'GET', url: '/api/fresh-workers' });
		expect(r.status).toBe(200);
		expect(r.body.wallets[0].error).toBe('fund_failed');
		expect(JSON.stringify(r.body)).not.toContain('SECRETKEY123');
	});
});

describe('/api/x402-status', () => {
	it('hides driver errors and secret names from the public', async () => {
		const { default: handler } = await import('../api/x402-status.js');
		const r = await invoke(handler, { method: 'GET', url: '/api/x402-status' });
		const text = JSON.stringify(r.body);
		expect(text).not.toContain('10.8.0.3');
		expect(text).not.toContain('db-host-internal');
		expect(text).not.toContain('X402_TREASURY_SECRET_BASE58');
		expect(r.body.ring.config_warning_count).toBe(1);
		expect(r.body.siwx.configured).toBe(false);
	});

	it('refuses a flood before it fans out to the facilitators', async () => {
		rateOk = false;
		const { default: handler } = await import('../api/x402-status.js');
		const r = await invoke(handler, { method: 'GET', url: '/api/x402-status' });
		expect(r.status).toBe(429);
		expect(probeFacilitators).not.toHaveBeenCalled();
	});

	it('still gives the operator the full detail', async () => {
		opsOk = true;
		const { default: handler } = await import('../api/x402-status.js');
		const r = await invoke(handler, { method: 'GET', url: '/api/x402-status' });
		expect(r.body.ring.config_warnings[0].code).toBe('treasury_secret_missing');
		expect(r.body.settlements.error).toBe('settlement_stats_unavailable');
		expect(r.body.settlements.detail).toContain('ECONNREFUSED');
		expect(r.body.siwx.detail).toContain('siwx_payments');
	});
});
