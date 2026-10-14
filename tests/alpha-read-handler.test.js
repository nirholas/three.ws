// Boundary coverage for POST /api/agents/:id/alpha/read: the in-character
// alpha co-pilot's live-launch read. The contract under test here is narrow:
// when the LLM chain is exhausted by an opaque upstream failure (the common
// case in production: LlmUnavailableError is effectively unreachable once
// the keyless OVH/Pollinations lanes are unconditional, per llm.js's own
// tests), the generic 502 branch must log a diagnostic line naming the
// mint and the upstream failure, the same way api/persona/preview.js does.
// Before this fix the branch returned 502 silently, making every chain-
// exhaustion failure on this route invisible in production logs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSessionUserMock = vi.fn();
const authenticateBearerMock = vi.fn();
const extractBearerMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: (...a) => authenticateBearerMock(...a),
	extractBearer: (...a) => extractBearerMock(...a),
}));

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));

const tradePerUserLimit = vi.fn();
const publicIpLimit = vi.fn();
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		tradePerUser: (...a) => tradePerUserLimit(...a),
		publicIp: (...a) => publicIpLimit(...a),
	},
	clientIp: () => '127.0.0.1',
}));

vi.mock('../api/_lib/agent-pumpfun.js', () => ({
	solanaPublicConnection: () => ({ getBalance: vi.fn().mockResolvedValue(0) }),
}));
vi.mock('../api/_lib/smart-money.js', () => ({
	getSmartMoneyForMint: vi.fn().mockResolvedValue({ smart_money_score: 58, count: 3, sybil_flag: false }),
}));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({
	getTradeLimits: () => ({ per_trade_sol: 0.5, daily_budget_sol: 2, kill_switch: false }),
	getSpendLimits: () => ({ frozen: false }),
	getDailySpendLamports: vi.fn().mockResolvedValue(0n),
}));
vi.mock('../api/_lib/solana/sdk-bridge.js', () => ({
	getBondingCurveState: vi.fn().mockResolvedValue({ realSolReserves: 8_400_000_000n, complete: false }),
	getBuyQuote: vi.fn().mockResolvedValue({ priceImpact: 2.3 }),
	getGraduationProgress: vi.fn().mockResolvedValue({ progress: 0.41 }),
}));
vi.mock('../api/_lib/pumpfun-ws-feed.js', () => ({
	connectPumpFunFeed: vi.fn(),
	recentBuffered: vi.fn().mockReturnValue([]),
	recentGraduations: vi.fn().mockReturnValue([]),
}));
vi.mock('../api/_lib/pump-feed-fetch.js', () => ({
	pumpFetchJson: vi.fn().mockResolvedValue({ ok: true, body: { symbol: 'WIDGET', name: 'Widget', usd_market_cap: 23000, created_timestamp: Date.now() - 14 * 60_000 } }),
}));
vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstreamJson: vi.fn().mockResolvedValue({ pairs: [] }),
}));

const llmCompleteMock = vi.fn();
class FakeLlmUnavailable extends Error {}
vi.mock('../api/_lib/llm.js', () => ({
	llmComplete: (...a) => llmCompleteMock(...a),
	LlmUnavailableError: FakeLlmUnavailable,
}));

const { default: alphaHandler } = await import('../api/agents/alpha.js');

const AGENT_ID = 'agent-1';
const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

function mkReq({ body } = {}) {
	return {
		method: 'POST',
		url: `/api/agents/${AGENT_ID}/alpha/read`,
		headers: { 'content-type': 'application/json' },
		on(event, cb) {
			if (event === 'data' && body != null) {
				const buf = Buffer.from(JSON.stringify(body));
				queueMicrotask(() => { cb(buf); this._endCb?.(); });
			} else if (event === 'end') this._endCb = cb;
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: undefined, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}
const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);

async function callRead(body) {
	const res = mkRes();
	await alphaHandler(mkReq({ body }), res, AGENT_ID, 'read');
	return res;
}

describe('POST /api/agents/:id/alpha/read - LLM failure handling', () => {
	let consoleErrorSpy;

	beforeEach(() => {
		vi.clearAllMocks();
		getSessionUserMock.mockResolvedValue(null);
		authenticateBearerMock.mockResolvedValue(null);
		tradePerUserLimit.mockResolvedValue({ success: true });
		publicIpLimit.mockResolvedValue({ success: true });
		sqlMock.mockImplementation(() => {
			const rows = [{
				id: AGENT_ID, user_id: 'owner-1', name: 'Scout', persona_prompt: 'terse trader',
				voice_provider: 'browser', voice_id: null, avatar_id: null,
				is_published: true, meta: {},
			}];
			const p = Promise.resolve(rows);
			p.catch = (fn) => p.then(undefined, fn);
			return p;
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	it('returns 503 narrator_offline and does not require a diagnostic log when the provider chain reports LlmUnavailableError', async () => {
		llmCompleteMock.mockRejectedValue(new FakeLlmUnavailable('no provider configured'));
		const res = await callRead({ mint: MINT, network: 'mainnet' });
		expect(res.statusCode).toBe(503);
		expect(parse(res).error).toBe('narrator_offline');
	});

	it('logs a diagnostic line naming the mint and the upstream failure when the chain is exhausted by an opaque upstream error', async () => {
		llmCompleteMock.mockRejectedValue(Object.assign(new Error('nvidia unreachable: fetch failed'), {
			status: 502, code: 'upstream_error',
		}));
		const res = await callRead({ mint: MINT, network: 'mainnet' });

		expect(res.statusCode).toBe(502);
		expect(parse(res).error).toBe('read_failed');
		// The bug: this branch used to return 502 with zero logging, so every
		// chain-exhaustion failure on this route was invisible in production logs.
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('[agents/alpha]'),
			MINT,
			expect.stringContaining('nvidia unreachable'),
		);
	});

	it('returns 429 daily_spend_cap_exceeded without masking it as read_failed', async () => {
		llmCompleteMock.mockRejectedValue(Object.assign(new Error('daily cap hit'), {
			code: 'daily_spend_cap_exceeded',
		}));
		const res = await callRead({ mint: MINT, network: 'mainnet' });
		expect(res.statusCode).toBe(429);
		expect(parse(res).error).toBe('daily_spend_cap_exceeded');
	});
});
