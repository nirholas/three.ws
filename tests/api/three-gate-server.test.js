// Server-side $THREE gate: checkThreeBalance, GET /api/pump/check-three-balance
// and the paid-skill executor gate. Only the network boundaries (Solana RPC,
// Redis, DB, payment verification) are mocked. The contract under test: an RPC
// failure must never read as eligible.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ getParsedTokenAccountsByOwner: vi.fn() }));
vi.mock('../../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: () => rpc }));

const redisState = vi.hoisted(() => ({ store: new Map(), client: null }));
vi.mock('../../api/_lib/redis.js', () => ({ getRedis: () => redisState.client }));

const sqlMock = vi.hoisted(() => vi.fn());
vi.mock('../../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => ({ id: 'user-1' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));
const x402 = vi.hoisted(() => ({
	emit402: vi.fn(),
	verifyPaid: vi.fn(),
	consumeIntent: vi.fn(),
	releaseIntent: vi.fn(),
	manifestOnly: vi.fn(),
}));
vi.mock('../../api/_lib/x402.js', () => x402);
vi.mock('../../api/_lib/skill-access.js', () => ({
	hasSkillAccess: async () => ({ paid: false, owned: false }),
	consumeTrialUse: async () => {},
	logSkillUsage: () => {},
}));
vi.mock('../../api/_lib/skill-license-verify.js', () => ({ enforceOnchainLicense: async () => ({}) }));
vi.mock('../../api/_lib/notify.js', () => ({ insertNotification: () => {} }));
vi.mock('../../api/_lib/fee.js', () => ({ calculateFee: () => ({ fee: 0 }) }));

import { checkThreeBalance } from '../../api/_lib/three-gate.js';
import balanceHandler from '../../api/pump/check-three-balance.js';
import invokeHandler from '../../api/agents/x402/[action].js';

const WALLET = '11111111111111111111111111111112';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';

function holding(amount) {
	return { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } }] };
}

function mockRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; },
	};
	return res;
}
const parsed = (res) => JSON.parse(res.body);

beforeEach(() => {
	vi.clearAllMocks();
	redisState.store.clear();
	redisState.client = {
		get: async (k) => redisState.store.get(k) ?? null,
		set: vi.fn(async (k, v) => { redisState.store.set(k, v); }),
	};
});

describe('checkThreeBalance', () => {
	it('is not eligible and not cached when the RPC fails on every attempt', async () => {
		rpc.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('all lanes exhausted'));
		const r = await checkThreeBalance(WALLET, 1);
		expect(r.eligible).toBe(false);
		expect(r.unavailable).toBe(true);
		expect(r.reason).toBe('rpc_unavailable');
		expect(r.balance).toBeNull();
		expect(redisState.client.set).not.toHaveBeenCalled();
	});

	it('retries once and uses the second read when the first attempt fails', async () => {
		rpc.getParsedTokenAccountsByOwner
			.mockRejectedValueOnce(new Error('429'))
			.mockResolvedValueOnce(holding('5'));
		const r = await checkThreeBalance(WALLET, 1);
		expect(r).toMatchObject({ eligible: true, balance: 5 });
		expect(r.unavailable).toBeUndefined();
	});

	it('reports a below-minimum balance as not eligible and caches it', async () => {
		rpc.getParsedTokenAccountsByOwner.mockResolvedValue(holding('2'));
		const r = await checkThreeBalance(WALLET, 10);
		expect(r).toMatchObject({ eligible: false, balance: 2, min: 10 });
		expect(r.unavailable).toBeUndefined();
		expect(redisState.client.set).toHaveBeenCalledTimes(1);
	});

	it('reports an above-minimum balance as eligible', async () => {
		rpc.getParsedTokenAccountsByOwner.mockResolvedValue(holding('50'));
		const r = await checkThreeBalance(WALLET, 10);
		expect(r).toMatchObject({ eligible: true, balance: 50 });
	});
});

describe('GET /api/pump/check-three-balance', () => {
	it('answers 503 rpc_unavailable with Retry-After and no eligible field on RPC failure', async () => {
		rpc.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('down'));
		const res = mockRes();
		await balanceHandler({ method: 'GET', query: { wallet: WALLET, min: '1' }, headers: {} }, res);
		expect(res.statusCode).toBe(503);
		expect(res.headers['retry-after']).toBe('5');
		const body = parsed(res);
		expect(body.error).toBe('rpc_unavailable');
		expect('eligible' in body).toBe(false);
	});

	it('keeps the 200 shape for a real read', async () => {
		rpc.getParsedTokenAccountsByOwner.mockResolvedValue(holding('7'));
		const res = mockRes();
		await balanceHandler({ method: 'GET', query: { wallet: WALLET, min: '1' }, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(parsed(res)).toMatchObject({ wallet: WALLET, balance: 7, min: 1, eligible: true });
	});
});

describe('paid-skill executor gate', () => {
	function invokeReq() {
		return {
			method: 'POST',
			url: '/api/agents/x402/invoke',
			query: { action: 'invoke' },
			headers: { 'content-type': 'application/json' },
			body: { agent_id: AGENT_ID, skill: 'echo', args: { a: 1 } },
		};
	}

	beforeEach(() => {
		sqlMock.mockImplementation(async (strings) => {
			const q = strings.join('?');
			if (q.includes('from agent_identities')) {
				return [{
					id: AGENT_ID, user_id: 'owner', name: 'a', skills: ['echo'],
					meta: {
						three_gate: { enabled: true, min_balance: 3 },
						skill_prices: { echo: { amount: '1000', currency: 'USDC' } },
					},
				}];
			}
			return [];
		});
		x402.verifyPaid.mockResolvedValue({ intentId: 'intent-1', payerAddress: WALLET });
		x402.consumeIntent.mockResolvedValue(true);
	});

	it('answers 503 three_gate_unavailable and leaves the intent unconsumed when the RPC is down', async () => {
		rpc.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('down'));
		const res = mockRes();
		await invokeHandler(invokeReq(), res);
		expect(res.statusCode).toBe(503);
		const body = parsed(res);
		expect(body.error).toBe('three_gate_unavailable');
		expect(body.retry).toBe(true);
		expect(x402.consumeIntent).not.toHaveBeenCalled();
	});

	it('still answers 402 insufficient_three_balance for a real below-minimum read', async () => {
		rpc.getParsedTokenAccountsByOwner.mockResolvedValue(holding('1'));
		const res = mockRes();
		await invokeHandler(invokeReq(), res);
		expect(res.statusCode).toBe(402);
		expect(parsed(res).error).toBe('insufficient_three_balance');
		expect(x402.consumeIntent).not.toHaveBeenCalled();
	});

	it('executes the skill for an eligible holder', async () => {
		rpc.getParsedTokenAccountsByOwner.mockResolvedValue(holding('9'));
		const res = mockRes();
		await invokeHandler(invokeReq(), res);
		expect(res.statusCode).toBe(200);
		expect(x402.consumeIntent).toHaveBeenCalledWith('intent-1');
	});
});
