// Isolated TRELLIS NIM demo endpoint (/api/nim-forge) — readiness, the /v1/infer
// request contract, GLB extraction across artifact shapes, and error mapping.
// Global fetch is stubbed; no live NIM is contacted.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Making or uploading needs an account (api/_lib/creator-account.js). These
// cases exercise what happens past that gate, so the caller is signed in. The
// gate itself has its own suite in tests/creation-endpoints-auth.test.js.
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'creator-test-user' }),
}));

const ORIGINAL_FETCH = globalThis.fetch;
process.env.NIM_TRELLIS_URL = 'https://nim.example.run.app';
process.env.NIM_TRELLIS_KEY = 'nim-secret';

const { default: handler } = await import('../../api/nim-forge.js');

function makeReq(method = 'GET', body = null) {
	const req = { url: '/api/nim-forge', method, headers: { host: 'x' } };
	if (body !== null) {
		req.headers['content-type'] = 'application/json';
		const buf = Buffer.from(JSON.stringify(body));
		req.on = (ev, fn) => {
			if (ev === 'data') queueMicrotask(() => fn(buf));
			if (ev === 'end') queueMicrotask(fn);
			return req;
		};
	}
	return req;
}
function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; this.writableEnded = true; },
	};
}
async function call(method = 'GET', body = null) {
	const res = makeRes();
	await handler(makeReq(method, body), res);
	let parsed = null;
	try { parsed = JSON.parse(res._body); } catch { /* non-JSON */ }
	return { res, body: parsed };
}

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/AP+AAAAAElFTkSuQmCC';

function jsonResponse(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

beforeEach(() => {
	process.env.NIM_TRELLIS_URL = 'https://nim.example.run.app';
	process.env.NIM_TRELLIS_KEY = 'nim-secret';
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

describe('GET /api/nim-forge — readiness', () => {
	it('reports configured without leaking the URL or key', async () => {
		const { res, body } = await call('GET');
		expect(res.statusCode).toBe(200);
		expect(body.configured).toBe(true);
		expect(body.endpoint).toBe('/v1/infer');
		expect(JSON.stringify(body)).not.toContain('nim.example');
		expect(JSON.stringify(body)).not.toContain('nim-secret');
	});
});

describe('POST /api/nim-forge — image→3D contract', () => {
	it('posts mode:image to <NIM>/v1/infer with auth and returns the GLB', async () => {
		const glb = Buffer.from('GLB\0trellis-mesh');
		const glbB64 = glb.toString('base64');
		const fetchMock = vi.fn(async (url, opts) => {
			expect(url).toBe('https://nim.example.run.app/v1/infer');
			expect(opts.method).toBe('POST');
			expect(opts.headers.authorization).toBe('Bearer nim-secret');
			const sent = JSON.parse(opts.body);
			expect(sent.mode).toBe('image');
			expect(sent.image).toBe(PNG_DATA_URI);
			expect(sent.output_format).toBe('glb');
			expect(sent.ss_sampling_steps).toBe(25); // standard tier
			return jsonResponse({ artifacts: [{ base64: glbB64 }] }, 200);
		});
		globalThis.fetch = fetchMock;

		const { res, body } = await call('POST', { image: PNG_DATA_URI, tier: 'standard' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(res.statusCode).toBe(200);
		expect(body.glb_base64).toBe(glbB64);
		expect(body.bytes).toBe(glb.length);
		expect(body.mode).toBe('image_to_3d');
		expect(body.steps).toBe(25);
	});

	it('maps quality tiers to sampling steps', async () => {
		globalThis.fetch = vi.fn(async () => jsonResponse({ artifacts: [{ base64: Buffer.from('x').toString('base64') }] }));
		const draft = await call('POST', { image: PNG_DATA_URI, tier: 'draft' });
		expect(draft.body.steps).toBe(15);
		const high = await call('POST', { image: PNG_DATA_URI, tier: 'high' });
		expect(high.body.steps).toBe(50);
	});

	it('extracts a GLB returned as raw model bytes (Accept ignored)', async () => {
		const glb = Buffer.from('GLBrawbytes');
		globalThis.fetch = vi.fn(async () => new Response(glb, {
			status: 200,
			headers: { 'content-type': 'model/gltf-binary' },
		}));
		const { res, body } = await call('POST', { image: PNG_DATA_URI });
		expect(res.statusCode).toBe(200);
		expect(body.glb_base64).toBe(glb.toString('base64'));
	});

	it('supports text→3D when no image is given', async () => {
		const fetchMock = vi.fn(async (url, opts) => {
			const sent = JSON.parse(opts.body);
			expect(sent.mode).toBe('text');
			expect(sent.prompt).toBe('a red fox');
			return jsonResponse({ artifacts: [{ base64: Buffer.from('m').toString('base64') }] });
		});
		globalThis.fetch = fetchMock;
		const { res, body } = await call('POST', { prompt: 'a red fox' });
		expect(res.statusCode).toBe(200);
		expect(body.mode).toBe('text_to_3d');
	});
});

describe('POST /api/nim-forge — validation + error mapping', () => {
	it('rejects a request with neither image nor prompt', async () => {
		const { res, body } = await call('POST', { tier: 'standard' });
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('bad_request');
	});

	it('rejects an image that is not a base64 data-uri', async () => {
		const { res, body } = await call('POST', { image: 'https://example.com/photo.png' });
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('bad_image');
	});

	it('surfaces an upstream NIM error as a 502 with the detail', async () => {
		globalThis.fetch = vi.fn(async () => jsonResponse({ detail: 'bad image' }, 422));
		const { res, body } = await call('POST', { image: PNG_DATA_URI });
		expect(res.statusCode).toBe(502);
		expect(body.error).toBe('nim_error');
		expect(body.upstream_status).toBe(422);
		expect(body.message).toContain('bad image');
	});

	it('reports nim_unreachable when the NIM connection throws', async () => {
		globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
		const { res, body } = await call('POST', { image: PNG_DATA_URI });
		expect(res.statusCode).toBe(502);
		expect(body.error).toBe('nim_unreachable');
	});

	it('reports nim_no_glb when the NIM returns no artifact', async () => {
		globalThis.fetch = vi.fn(async () => jsonResponse({ artifacts: [] }, 200));
		const { res, body } = await call('POST', { image: PNG_DATA_URI });
		expect(res.statusCode).toBe(502);
		expect(body.error).toBe('nim_no_glb');
	});
});

describe('POST /api/nim-forge — unconfigured deployment', () => {
	it('returns 503 with a setup hint when no NIM URL is set', async () => {
		vi.resetModules();
		delete process.env.NIM_TRELLIS_URL;
		delete process.env.MODEL_TRELLIS_URL;
		const { default: freshHandler } = await import('../../api/nim-forge.js?unconfigured');
		const res = makeRes();
		await freshHandler(makeReq('POST', { image: PNG_DATA_URI }), res);
		const body = JSON.parse(res._body);
		expect(res.statusCode).toBe(503);
		expect(body.error).toBe('unconfigured');
		expect(body.message).toContain('NIM_TRELLIS_URL');
	});
});
