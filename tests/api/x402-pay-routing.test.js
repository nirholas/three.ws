// /api/x402-pay — payer routing. An agent context (an `agentId` on the request)
// must ALWAYS pay from that agent's own wallet; the shared platform wallet is an
// explicit fallback used only when no agent context is present, and that fallback
// is logged (never silent) so a regression that drops the agentId is visible.
//
// Mocks auth + rate-limit + the logger + fs so no funds move and no network I/O
// happens — we assert the routing decision and the fallback log only.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUserMock = vi.fn(async () => null);
const authenticateBearerMock = vi.fn(async () => null);
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: (...a) => authenticateBearerMock(...a),
	extractBearer: () => null,
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		x402PayIp: vi.fn(async () => ({ success: true })),
		x402PayGlobal: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));

// Capture warn() calls so we can assert the platform-fallback is logged.
const warnMock = vi.fn();
vi.mock('../../api/_lib/usage.js', () => ({
	logger: () => ({ info: vi.fn(), warn: warnMock, error: vi.fn() }),
	recordEvent: vi.fn(),
}));

vi.mock('../../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../../api/_lib/db.js', () => ({ sql: vi.fn(async () => []), isDbUnavailableError: () => false, isDbCapacityError: () => false }));

// No shared platform wallet configured + no dev keypair file → loadAgentKeypair()
// throws config-missing, which is the deterministic outcome we assert for the
// fallback path (the warn must already have fired before this throws). Only the
// dev test-wallet read is refused: repo data the import graph loads at module
// time (data/plans.json via api/payments/_config.js) still reads from disk.
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal();
	const readFileSync = (file, ...rest) => {
		if (String(file).includes('x402-test-wallets')) throw new Error('no dev keypair');
		return actual.readFileSync(file, ...rest);
	};
	return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

delete process.env.X402_AGENT_SOLANA_SECRET_BASE58;

const mod = await import('../../api/x402-pay.js');
const { default: handler, resolvePayerRouting } = mod;

function makeReq(body, headers = {}) {
	const req = {
		url: '/api/x402-pay',
		method: 'POST',
		headers: { host: 'x', 'content-type': 'application/json', ...headers },
		query: {},
	};
	const buf = Buffer.from(JSON.stringify(body));
	let read = false;
	req.on = (event, cb) => {
		if (event === 'data' && !read) {
			cb(buf);
			read = true;
		} else if (event === 'end') queueMicrotask(cb);
		return req;
	};
	req.headers['content-length'] = String(buf.length);
	return req;
}
function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) {
			this._h[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._h[k.toLowerCase()];
		},
		end(b) {
			this._body = b;
		},
	};
}
async function call(body) {
	const res = makeRes();
	await handler(makeReq(body), res);
	let parsed = null;
	try {
		parsed = JSON.parse(res._body);
	} catch {}
	return { res, body: parsed };
}

beforeEach(() => {
	warnMock.mockReset();
	getSessionUserMock.mockReset().mockResolvedValue(null);
	authenticateBearerMock.mockReset().mockResolvedValue(null);
});

describe('resolvePayerRouting', () => {
	it('routes to the per-agent wallet when an agentId is present', () => {
		expect(resolvePayerRouting({ agentId: 'a1', tool: 'tools/list' })).toEqual({
			mode: 'agent',
			agentId: 'a1',
		});
	});

	it('falls back to the platform wallet only when no agent context is present', () => {
		expect(resolvePayerRouting({ tool: 'tools/list' })).toEqual({ mode: 'platform' });
		expect(resolvePayerRouting({})).toEqual({ mode: 'platform' });
	});

	it('coerces a non-string agentId to its string form for the agent path', () => {
		expect(resolvePayerRouting({ agentId: 123 })).toEqual({ mode: 'agent', agentId: '123' });
	});
});

describe('POST /api/x402-pay payer routing', () => {
	it('an agent context requires auth — never silently spends the shared wallet', async () => {
		// agentId present but unauthenticated → 401, NOT a fall-through to the
		// shared platform wallet. The shared wallet can never pay for an agent.
		const { res, body } = await call({ tool: 'tools/list', agentId: 'a1' });
		expect(res.statusCode).toBe(401);
		expect(body.error).toBe('authentication_required');
		expect(warnMock).not.toHaveBeenCalledWith('platform_wallet_fallback', expect.anything());
	});

	it('no agent context logs the platform fallback (not silent)', async () => {
		const { res } = await call({ tool: 'tools/list' });
		// The shared wallet is unconfigured in tests → 503 config_missing, but the
		// fallback must have been logged before that.
		expect(res.statusCode).toBe(503);
		expect(warnMock).toHaveBeenCalledWith(
			'platform_wallet_fallback',
			expect.objectContaining({ reason: 'no_agent_context' }),
		);
	});

	it('an external-pay request with no agent context is refused, not routed to the shared wallet', async () => {
		const { res, body } = await call({ url: 'https://example.com/paid' });
		// requireAuth → null first, so 401; the key point is no shared-wallet pay.
		expect(res.statusCode).toBe(401);
		expect(body.error).toBe('authentication_required');
	});
});
