// HTTP-level tests for the $THREE hold-to-access gate on POST /api/forge.
//
// The High tier (200k poly + PBR) on a PLATFORM-keyed backend spends real
// GPU/vendor budget, so it's reserved for $THREE holders (Bronze+), proven by a
// signed tier pass (pure-HMAC, no RPC) or — when no pass is presented — the
// session user's on-chain tier. A non-holder gets a hold-or-pay 402. These tests
// pin the contract edges:
//   • High + platform backend + no pass        → 402 three_hold_required (full payload)
//   • High + platform backend + valid Bronze   → gate lets it through (not 402)
//   • High + BYOK backend (caller's own key)   → never gated (key-gated instead)
//   • Standard / Draft tier                    → never gated
//   • Tampered pass                            → gated as a non-holder
//
// The gate runs BEFORE the rate limiter and any provider call, so the 402 path is
// fully network-free (anonymous → no DB/RPC). The pass-allows / BYOK / standard
// paths fall through to a designed downstream state (needs_key / unconfigured)
// because no vendor key is configured — never a real upstream call.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Readable } from 'node:stream';
import { signTierPass } from '../api/_lib/three-tier.js';
import { TOKEN_MINT } from '../api/_lib/token/config.js';

// POST /api/forge needs an account (api/_lib/creator-account.js). These tests
// exercise what happens past that gate, so the caller is a signed-in account.
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

let forge;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ body = null, headers = {} } = {}) {
	const chunks = body != null ? [Buffer.from(JSON.stringify(body))] : [];
	const r = Readable.from(chunks);
	r.method = 'POST';
	r.url = '/api/forge';
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}

// A synthetic Solana-shaped wallet — signTierPass doesn't validate the address,
// and the gate trusts the signed level, never the wallet.
const WALLET = 'THREEsynthetic1111111111111111111111111111';

beforeAll(async () => {
	// Dev secret for tier-pass sign/verify symmetry; in-memory (fail-open) limiter.
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	// No platform vendor key → the post-gate platform path lands on a clean 503
	// 'unconfigured' instead of making a real Replicate call. Keeps every
	// not-402 assertion hermetic regardless of the CI environment.
	delete process.env.REPLICATE_API_TOKEN;
	forge = (await import('../api/forge.js')).default;
});

describe('POST /api/forge — $THREE High-tier gate', () => {
	it('blocks High on a platform backend with no pass — 402 three_hold_required + full payload', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'high', backend: 'trellis' } }), res);

		expect(res.statusCode).toBe(402);
		const b = res.json;
		expect(b.error).toBe('three_hold_required');
		expect(b.feature).toBe('forge.high');
		// Required tier is Bronze (level 1); the anonymous caller holds Member (level 0).
		expect(b.required).toMatchObject({ level: 1, id: 'bronze', min_usd: 25 });
		expect(b.held).toMatchObject({ level: 0, id: 'member', usd: 0 });
		expect(typeof b.why).toBe('string');
		expect(b.why.length).toBeGreaterThan(0);
		// Anonymous → sign in, with the exact gap to the entry tier.
		expect(b.reason).toBe('sign_in');
		expect(b.usd_to_go).toBe(25);
		// Designed acquire block + exact pay-per-use price pulled from the catalog ($0.50).
		expect(b.acquire.mint).toBe(TOKEN_MINT);
		expect(b.acquire.swap_url).toContain(TOKEN_MINT);
		expect(b.pay_per_use).toMatchObject({ action: 'forge.high', usd: 0.5 });
		expect(b.message).toMatch(/Bronze/);
	});

	it('lets High through with a valid Bronze+ pass (not blocked by the gate)', async () => {
		const pass = signTierPass({ wallet: WALLET, level: 1, tierId: 'bronze', usd: 30 });
		const res = mockRes();
		await forge(
			mockReq({
				body: { prompt: 'a brass telescope', tier: 'high', backend: 'trellis' },
				headers: { 'x-three-tier-pass': pass },
			}),
			res,
		);

		// The gate must not fire: it falls through to the (unconfigured) generation
		// path, never the 402 holder lock.
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
		expect(res.json?.error).toBe('unconfigured');
	});

	it('accepts the pass via body.tier_pass as well as the header', async () => {
		const pass = signTierPass({ wallet: WALLET, level: 2, tierId: 'silver', usd: 120 });
		const res = mockRes();
		await forge(
			mockReq({ body: { prompt: 'a brass telescope', tier: 'high', backend: 'trellis', tier_pass: pass } }),
			res,
		);
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
	});

	it('does not gate High on a BYOK backend — key-gated, not hold-gated', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'high', backend: 'meshy' } }), res);

		// BYOK backends are exempt (the caller pays their own vendor). With no key
		// supplied they get the designed needs_key state — never the $THREE gate.
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
		expect(res.json?.error).toBe('needs_key');
	});

	it('never gates the Standard tier', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'standard', backend: 'trellis' } }), res);
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
	});

	it('never gates the Draft tier', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'draft', backend: 'trellis' } }), res);
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
	});

	it('rejects a tampered / invalid pass and gates as a non-holder', async () => {
		const res = mockRes();
		await forge(
			mockReq({
				body: { prompt: 'a brass telescope', tier: 'high', backend: 'trellis' },
				headers: { 'x-three-tier-pass': 'not.a.valid.pass' },
			}),
			res,
		);
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('three_hold_required');
	});
});
