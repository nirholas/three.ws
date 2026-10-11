// GET/POST /api/3d/engine-qa: the free, keyless engine-fitness report. The
// rate limiter is mocked (switchable per test) so the suite runs fully
// offline; the real handler, real gradeEngineQa core, real LOD-chain builder,
// and real print-pipeline STL export all run against a real bundled GLB
// uploaded as the request body (no network). URL-fetch paths are covered by
// asserting the input-validation contract (bad/missing input never 500s).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

let rlOk = true;
let lodRlOk = true;
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		apiIp: async (_ip, opts) => {
			const ok = opts?.limit === 10 ? lodRlOk : rlOk;
			return ok
				? { success: true, limit: opts?.limit ?? 60, remaining: 1, reset: Date.now() + 60_000 }
				: { success: false, limit: opts?.limit ?? 60, remaining: 0, reset: Date.now() + 60_000 };
		},
	},
	clientIp: () => '203.0.113.7',
}));

beforeEach(() => {
	rlOk = true;
	lodRlOk = true;
});

const avatar = (name) => resolve(process.cwd(), 'public/avatars', name);
const REAL_GLB = ['cesium-man.glb', 'fox.glb', 'mannequin.glb'].map(avatar).find(existsSync);

function makeReq({ method = 'GET', url = '/api/3d/engine-qa', headers = {}, body = null } = {}) {
	const chunks = body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)];
	const stream = Readable.from(chunks);
	stream.method = method;
	stream.url = url;
	stream.headers = { host: 'three.ws', ...headers };
	const qIdx = url.indexOf('?');
	stream.query = qIdx >= 0 ? Object.fromEntries(new URLSearchParams(url.slice(qIdx + 1))) : {};
	return stream;
}

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this._h[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._h[k.toLowerCase()];
		},
		end(body) {
			this._body = body;
			this.writableEnded = true;
		},
	};
}

async function dispatch(req, res) {
	const mod = await import('../../api/3d/engine-qa.js');
	await mod.default(req, res);
	const ct = String(res.getHeader('content-type') || '');
	const body = res._body && ct.includes('json') ? JSON.parse(res._body) : res._body;
	return { res, body };
}

describe('POST /api/3d/engine-qa: raw upload (real GLB, offline)', () => {
	it.runIf(REAL_GLB)('grades an uploaded GLB and returns the full report contract', async () => {
		const bytes = readFileSync(REAL_GLB);
		const { res, body } = await dispatch(
			makeReq({ method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes }),
			makeRes(),
		);
		expect(res.statusCode).toBe(200);
		expect(body.url).toBeNull();
		expect(body.sizeBytes).toBe(bytes.byteLength);
		expect(body.report.version).toBeTruthy();
		expect(['pass', 'warn', 'fail', 'skip']).toContain(body.report.overall);
		expect(body.report.checks.drawCalls).toBeTruthy();
		expect(body.report.checks.collider).toBeTruthy();
		expect(body.report.checks.triangleBudget.verdict).toBe('skip'); // no lods requested
		expect(typeof body.ts).toBe('string');
		expect(res.getHeader('cache-control')).toBe('no-store');
	}, 30_000);

	it.runIf(REAL_GLB)('lods=1 builds a real LOD chain and grades the triangle budget against it', async () => {
		const bytes = readFileSync(REAL_GLB);
		const { res, body } = await dispatch(
			makeReq({
				method: 'POST',
				url: '/api/3d/engine-qa?lods=1',
				headers: { 'content-type': 'application/octet-stream' },
				body: bytes,
			}),
			makeRes(),
		);
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(body.lods)).toBe(true);
		expect(body.lods.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < body.lods.length; i++) {
			expect(body.lods[i].triangleCount).toBeLessThan(body.lods[i - 1].triangleCount);
		}
		expect(body.report.checks.triangleBudget.verdict).not.toBe('skip');
	}, 60_000);

	it.runIf(REAL_GLB)('format=stl exports a binary STL for a watertight mesh', async () => {
		const bytes = readFileSync(REAL_GLB);
		const { res, body } = await dispatch(
			makeReq({
				method: 'POST',
				url: '/api/3d/engine-qa?format=stl',
				headers: { 'content-type': 'application/octet-stream' },
				body: bytes,
			}),
			makeRes(),
		);
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('content-type')).toBe('model/stl');
		expect(Buffer.isBuffer(body)).toBe(true);
		expect(body.length).toBeGreaterThan(84); // 80-byte header + 4-byte triangle count
	}, 30_000);

	it('rejects an empty upload with 400 (never 500)', async () => {
		const { res, body } = await dispatch(
			makeReq({ method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: null }),
			makeRes(),
		);
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('empty_body');
	});

	it('rejects non-model bytes with 422 invalid_model (never 500)', async () => {
		const { res, body } = await dispatch(
			makeReq({
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: Buffer.from('this is definitely not a glb file'),
			}),
			makeRes(),
		);
		expect(res.statusCode).toBe(422);
		expect(body.error).toBe('invalid_model');
	});
});

describe('input validation', () => {
	it('GET with no url → 400 missing_url', async () => {
		const { res, body } = await dispatch(makeReq({ method: 'GET', url: '/api/3d/engine-qa' }), makeRes());
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('missing_url');
	});

	it('POST JSON with no url → 400 missing_url', async () => {
		const { res, body } = await dispatch(
			makeReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noturl: 1 }) }),
			makeRes(),
		);
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('missing_url');
	});

	it('bad format value → 400 bad_format', async () => {
		const bytes = readFileSync(REAL_GLB);
		const { res, body } = await dispatch(
			makeReq({
				method: 'POST',
				url: '/api/3d/engine-qa?format=obj',
				headers: { 'content-type': 'application/octet-stream' },
				body: bytes,
			}),
			makeRes(),
		);
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('bad_format');
	});

	it('unsupported method → 405', async () => {
		const { res } = await dispatch(makeReq({ method: 'DELETE' }), makeRes());
		expect(res.statusCode).toBe(405);
	});

	it('rate-limited on the generic bucket → 429', async () => {
		rlOk = false;
		const { res, body } = await dispatch(
			makeReq({ method: 'GET', url: '/api/3d/engine-qa?url=https://three.ws/x.glb' }),
			makeRes(),
		);
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
	});

	it('rate-limited on the stricter lods bucket → 429 even when the generic bucket has room', async () => {
		lodRlOk = false;
		const { res, body } = await dispatch(
			makeReq({ method: 'GET', url: '/api/3d/engine-qa?url=https://three.ws/x.glb&lods=1' }),
			makeRes(),
		);
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
	});

	it('a URL pointing at a private address is the caller fault → 400, not a 502', async () => {
		const { res, body } = await dispatch(
			makeReq({ method: 'GET', url: '/api/3d/engine-qa?url=https://127.0.0.1/model.glb' }),
			makeRes(),
		);
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('invalid_url');
	});
});
