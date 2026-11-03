// GET /api/forge-remesh?job=<id>&mirror=r2: forge-in-world asks for the finished
// GLB to be copied into first-party storage, because the room's asset allow-list
// refuses the remesh worker's own URL. The mirror is opt-in (every other caller
// keeps the worker URL untouched) and honest: when the copy fails, the response
// says `durable: false` instead of passing a URL the world will refuse.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const stub = vi.hoisted(() => ({
	status: { status: 'done', resultGlbUrl: 'https://worker.example/out/abc.glb', faceCount: 42_000 },
	mirrored: { url: 'https://pub-x.r2.dev/forge/world-props/deadbeef.glb', bytes: 123_456, durable: true },
	mirror: vi.fn(),
}));

vi.mock('../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: () => true,
		status: async () => stub.status,
	}),
}));
vi.mock('../api/_lib/mirror-r2.js', () => ({
	mirrorToR2: (...args) => stub.mirror(...args),
}));

let remesh;
const JOB = 'remesh-job-0123456789abcdef';

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}
function mockGet(query) {
	const r = Readable.from([]);
	r.method = 'GET';
	r.url = `/api/forge-remesh?${query}`;
	r.headers = { origin: 'http://localhost:3000' };
	return r;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	remesh = (await import('../api/forge-remesh.js')).default;
});
beforeEach(() => {
	stub.status = { status: 'done', resultGlbUrl: 'https://worker.example/out/abc.glb', faceCount: 42_000 };
	stub.mirror.mockReset();
	stub.mirror.mockResolvedValue(stub.mirrored);
});

describe('GET /api/forge-remesh mirror=r2', () => {
	it('returns the first-party URL and durable:true once the result is mirrored', async () => {
		const res = mockRes();
		await remesh(mockGet(`job=${JOB}&mirror=r2`), res);
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ status: 'done', result_url: stub.mirrored.url, durable: true, bytes: 123_456, face_count: 42_000 });
		const [sourceUrl, key] = stub.mirror.mock.calls[0];
		expect(sourceUrl).toBe('https://worker.example/out/abc.glb');
		expect(key).toMatch(/^forge\/world-props\/[0-9a-f]{24}\.glb$/);
	});

	it('reports durable:false when the copy failed, never claiming the worker URL is loadable', async () => {
		stub.mirror.mockResolvedValue({ url: 'https://worker.example/out/abc.glb', bytes: null, durable: false });
		const res = mockRes();
		await remesh(mockGet(`job=${JOB}&mirror=r2`), res);
		expect(res.json).toMatchObject({ status: 'done', result_url: 'https://worker.example/out/abc.glb', durable: false });
	});

	it('leaves the worker URL alone when mirror is not requested', async () => {
		const res = mockRes();
		await remesh(mockGet(`job=${JOB}`), res);
		expect(res.json.result_url).toBe('https://worker.example/out/abc.glb');
		expect(res.json).not.toHaveProperty('durable');
		expect(stub.mirror).not.toHaveBeenCalled();
	});

	it('does not mirror a job that has not finished', async () => {
		stub.status = { status: 'running' };
		const res = mockRes();
		await remesh(mockGet(`job=${JOB}&mirror=r2`), res);
		expect(res.json.status).toBe('running');
		expect(stub.mirror).not.toHaveBeenCalled();
	});

	it('derives a stable key per job so a repeated poll overwrites instead of orphaning', async () => {
		await remesh(mockGet(`job=${JOB}&mirror=r2`), mockRes());
		await remesh(mockGet(`job=${JOB}&mirror=r2`), mockRes());
		expect(stub.mirror.mock.calls[0][1]).toBe(stub.mirror.mock.calls[1][1]);
	});
});
