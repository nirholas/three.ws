// GET /api/ops/forge-funnel: who can read the board, and what it answers when
// the database cannot be read.
//
// Measured on production 2026-11-27: no auth, a signed-in non-admin session and
// a wrong x-ops-secret all got 401, and the /forge-funnel page HTML carries no
// data. These tests hold that gate in place, plus the 2026-11-27 defect: with the
// database unreachable every panel fell back to zero and the endpoint answered
// 207 with a full board of zeros, which the page drew as a quiet week.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let auth = { ok: true, actor: 'ops-secret' };
vi.mock('../../api/_lib/ops-auth.js', () => ({ authorizeOps: vi.fn(async () => auth) }));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authedReadIp: vi.fn(async () => ({ success: true, limit: 300, remaining: 299, reset: Date.now() + 1000 })) },
	clientIp: () => '127.0.0.1',
}));

let sqlImpl = async () => [];
vi.mock('../../api/_lib/db.js', () => ({ sql: (...args) => sqlImpl(...args) }));

const { default: handler } = await import('../../api/ops/forge-funnel.js');

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this.writableEnded = true; this._body = body; },
	};
}

async function call(url = '/api/ops/forge-funnel?days=7') {
	const res = makeRes();
	await handler({ url, method: 'GET', headers: { host: 'three.ws' }, query: {} }, res);
	return { status: res.statusCode, body: JSON.parse(res._body), headers: res._h };
}

beforeEach(() => {
	auth = { ok: true, actor: 'ops-secret' };
	sqlImpl = async () => [];
});

describe('GET /api/ops/forge-funnel', () => {
	it('refuses anyone without an admin session or the ops secret, before reading anything', async () => {
		auth = { ok: false, actor: '' };
		sqlImpl = vi.fn(async () => []);
		const r = await call();
		expect(r.status).toBe(401);
		expect(r.body.error).toBe('unauthorized');
		expect(r.body.output).toBeUndefined();
		expect(sqlImpl).not.toHaveBeenCalled();
	});

	it('sends an admin without a second factor to verification', async () => {
		auth = { ok: false, actor: '', mfaRequired: true };
		const r = await call();
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('mfa_required');
		expect(r.body.verify_url).toBeTruthy();
	});

	it('answers 503 with no numbers when the database does not answer at all', async () => {
		sqlImpl = async () => { throw new Error('connect ECONNREFUSED'); };
		const r = await call();
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('database_unreachable');
		expect(r.body.output).toBeUndefined();
		expect(r.headers['cache-control']).toBe('no-store');
	});

	it('answers the board, privately, with its definitions and its blind spot', async () => {
		const r = await call();
		expect(r.status).toBe(200);
		expect(r.body.ok).toBe(true);
		expect(r.body.coverage.pre_job_failures).toBe('not_recorded');
		expect(r.body.definitions.map((d) => d.term)).toContain('success');
		expect(r.headers['cache-control']).toBe('private, no-store');
	});
});
