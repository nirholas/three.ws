// POST /api/v1/sentiment, GET /api/v1/market/intel, GET /api/v1/market/projects
//
// These three v1 routes already existed (afc56503b) but were undocumented and
// untested. This suite pins the contract catalog prompt 08 audits:
//   • sentiment is genuinely public (no aixbt/session/key needed) and rate-limited
//     per-IP by the gateway's shared apiV1 bucket, not silently unlimited.
//   • market/intel + market/projects degrade to an honest 503 `not_configured`
//     (never a 500) when AIXBT_API_KEY is absent, and serve real aixbt-shaped
//     data — publicly, no auth required — the moment it is.
//   • the gateway's per-IP rate limit (429) applies to every route.
//   • the /api/v1 catalog entries match observed behavior (path/auth/summary).
//
// The rate limiter, auth resolution, and usage metering are mocked (pure unit
// boundary); aixbt itself is mocked at `api/_lib/aixbt.js` with real-shaped
// fixtures rather than re-stubbing its HTTP client.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

let apiV1Ok = true;
let aixbtGlobalOk = true;
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		apiV1: async () =>
			apiV1Ok
				? { success: true, limit: 120, remaining: 119, reset: Date.now() + 60_000 }
				: { success: false, limit: 120, remaining: 0, reset: Date.now() + 60_000 },
		aixbtHourlyIp: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 3_600_000 }),
		aixbtGlobal: async () =>
			aixbtGlobalOk
				? { success: true, limit: 1800, remaining: 1799, reset: Date.now() + 3_600_000 }
				: { success: false, limit: 1800, remaining: 0, reset: Date.now() + 3_600_000 },
	},
	clientIp: () => '203.0.113.7',
}));

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => null,
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => true,
}));

vi.mock('../../api/_lib/usage.js', () => ({
	recordEvent: () => {},
}));

let aixbtEnabledFlag = true;
vi.mock('../../api/_lib/aixbt.js', () => ({
	aixbtEnabled: () => aixbtEnabledFlag,
	getIntel: async ({ limit, category, chain } = {}) => ({
		intel: [
			{
				id: 'intel-1',
				text: 'Momentum building in AI-agent infrastructure narratives.',
				category: category || 'narrative',
				chain: chain || 'solana',
				createdAt: '2026-07-08T00:00:00.000Z',
			},
		].slice(0, limit || 20),
		pagination: { limit: limit || 20, page: 1, hasMore: false },
	}),
	getProjects: async ({ limit, page, names, chain } = {}) => ({
		projects: [
			{
				id: 'proj-1',
				name: names || 'three.ws',
				ticker: 'THREE',
				chain: chain || 'solana',
				momentumScore: 87,
			},
		].slice(0, limit || 20),
		pagination: { limit: limit || 20, page: page || 1, hasMore: false },
	}),
}));

beforeEach(() => {
	apiV1Ok = true;
	aixbtGlobalOk = true;
	aixbtEnabledFlag = true;
});

function makeReq({ method = 'GET', url, host = 'three.ws', body } = {}) {
	const payload = body ? Buffer.from(JSON.stringify(body)) : null;
	const stream = payload ? Readable.from([payload]) : Readable.from([]);
	stream.method = method;
	stream.url = url;
	stream.headers = {
		host,
		...(payload ? { 'content-type': 'application/json' } : {}),
	};
	return stream;
}

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; this.writableEnded = true; },
	};
}

async function dispatch(modPath, req, res) {
	vi.resetModules();
	const mod = await import(modPath);
	await mod.default(req, res);
	return { res, body: res._body ? JSON.parse(res._body) : null };
}

// ── POST /api/v1/sentiment — genuinely public, no key needed ──────────────────
describe('POST /api/v1/sentiment', () => {
	it('classifies text with no auth required', async () => {
		const req = makeReq({ method: 'POST', url: '/api/v1/sentiment', body: { text: 'This is amazing, bullish, great news!' } });
		const { res, body } = await dispatch('../../api/v1/sentiment.js', req, makeRes());
		expect(res.statusCode).toBe(200);
		expect(body.data.sentiment).toBe('Positive');
		expect(typeof body.data.score).toBe('number');
	});

	it('rejects an empty text with 400', async () => {
		const req = makeReq({ method: 'POST', url: '/api/v1/sentiment', body: { text: '   ' } });
		const { res, body } = await dispatch('../../api/v1/sentiment.js', req, makeRes());
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('validation_error');
	});

	it('rate-limits per IP (429, not a hang or 500)', async () => {
		apiV1Ok = false;
		const req = makeReq({ method: 'POST', url: '/api/v1/sentiment', body: { text: 'hello' } });
		const { res, body } = await dispatch('../../api/v1/sentiment.js', req, makeRes());
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
	});
});

// ── GET /api/v1/market/intel — free once aixbt is configured, honest 503 if not
describe('GET /api/v1/market/intel', () => {
	it('returns 503 not_configured when AIXBT_API_KEY is absent — never a 500', async () => {
		aixbtEnabledFlag = false;
		const req = makeReq({ url: '/api/v1/market/intel' });
		const { res, body } = await dispatch('../../api/v1/market/intel.js', req, makeRes());
		// The gateway's `wrap` renders the canonical missing-env envelope: 503
		// not_configured, with a ref instead of the raw var name (which secret is
		// unset is operator information — see api/_lib/http.js `wrap`). The
		// operator-facing detail (AIXBT_API_KEY) is logged server-side.
		expect(res.statusCode).toBe(503);
		expect(body.error).toBe('not_configured');
		expect(body.error_description).toMatch(/not configured on this deployment/i);
	});

	it('serves real-shaped intel publicly with no auth once configured', async () => {
		const req = makeReq({ url: '/api/v1/market/intel?limit=5&category=narrative' });
		const { res, body } = await dispatch('../../api/v1/market/intel.js', req, makeRes());
		expect(res.statusCode).toBe(200);
		expect(body.data.source).toBe('aixbt');
		expect(Array.isArray(body.data.intel)).toBe(true);
		expect(body.data.intel[0]).toMatchObject({ id: 'intel-1', category: 'narrative' });
	});

	it('returns 429 when the shared aixbt ceiling is exhausted', async () => {
		aixbtGlobalOk = false;
		const req = makeReq({ url: '/api/v1/market/intel' });
		const { res, body } = await dispatch('../../api/v1/market/intel.js', req, makeRes());
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
	});

	it('rate-limits per IP at the gateway level (429)', async () => {
		apiV1Ok = false;
		const req = makeReq({ url: '/api/v1/market/intel' });
		const { res, body } = await dispatch('../../api/v1/market/intel.js', req, makeRes());
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
	});
});

// ── GET /api/v1/market/projects — same contract as market/intel ───────────────
describe('GET /api/v1/market/projects', () => {
	it('returns 503 not_configured when AIXBT_API_KEY is absent', async () => {
		aixbtEnabledFlag = false;
		const req = makeReq({ url: '/api/v1/market/projects' });
		const { res, body } = await dispatch('../../api/v1/market/projects.js', req, makeRes());
		expect(res.statusCode).toBe(503);
		expect(body.error).toBe('not_configured');
		expect(body.error_description).toMatch(/not configured on this deployment/i);
	});

	it('serves real-shaped, momentum-ranked projects publicly once configured', async () => {
		const req = makeReq({ url: '/api/v1/market/projects?limit=10&chain=solana' });
		const { res, body } = await dispatch('../../api/v1/market/projects.js', req, makeRes());
		expect(res.statusCode).toBe(200);
		expect(body.data.source).toBe('aixbt');
		expect(body.data.projects[0]).toMatchObject({ id: 'proj-1', chain: 'solana' });
	});
});

// ── /api/v1 catalog — entries match observed behavior ──────────────────────────
describe('/api/v1 catalog — sentiment + market intel/projects', () => {
	it('registers all three with accurate path/auth/summary', async () => {
		const { CATALOG } = await import('../../api/v1/_catalog.js');

		const sentiment = CATALOG.find((e) => e.id === 'v1.sentiment');
		expect(sentiment).toMatchObject({ method: 'POST', path: '/api/v1/sentiment', auth: 'public' });
		expect(sentiment.summary).toMatch(/sentiment/i);

		const intel = CATALOG.find((e) => e.id === 'v1.market.intel');
		expect(intel).toMatchObject({ method: 'GET', path: '/api/v1/market/intel', auth: 'optional' });
		expect(intel.summary).toMatch(/narrative|intelligence/i);

		const projects = CATALOG.find((e) => e.id === 'v1.market.projects');
		expect(projects).toMatchObject({ method: 'GET', path: '/api/v1/market/projects', auth: 'optional' });
		expect(projects.summary).toMatch(/momentum|projects/i);
	});
});
