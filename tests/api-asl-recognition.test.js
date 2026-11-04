// api/asl-recognition.js: the proxy to workers/model-asl-recognition. Covers the
// fingerspelling path staying exactly as it was, and the word-level `mode:
// 'signs'` route: validation, routing to /recognize-signs, rate limiting, and
// how a worker outage or a missing signs model is reported.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const limit = vi.fn(async () => ({ success: true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { aslTranscribeIp: (...a) => limit(...a) },
	clientIp: () => '127.0.0.1',
}));

const upstream = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({ fetchUpstream: (...a) => upstream(...a) }));

const llm = vi.fn();
vi.mock('../api/_lib/llm.js', () => ({ llmConfigured: () => true, llmComplete: (...a) => llm(...a) }));

const { default: handler } = await import('../api/asl-recognition.js');

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function call({ method = 'POST', query = '', body } = {}) {
	const raw = body === undefined ? '' : JSON.stringify(body);
	const req = Object.assign(Readable.from(raw ? [Buffer.from(raw)] : []), {
		method,
		url: `/api/asl-recognition${query}`,
		headers: { host: 'localhost', 'content-type': 'application/json' },
	});
	const res = {
		statusCode: 200,
		headers: {},
		body: undefined,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
	};
	return handler(req, res).then(() => ({ status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }));
}

const frames = Array.from({ length: 12 }, () => new Array(390).fill(0.5));

beforeEach(() => {
	process.env.GCP_ASL_RECOGNITION_URL = 'https://asl.example.test/';
	process.env.GCP_RECONSTRUCTION_KEY = 'secret';
	upstream.mockReset();
	llm.mockReset();
	limit.mockClear();
	limit.mockResolvedValue({ success: true });
});

describe('fingerspelling (default mode) is unchanged', () => {
	it('posts to /transcribe and cleans the text', async () => {
		upstream.mockResolvedValue(reply(200, { text: 'helo', confidence: 0.8, frames: 12, ms: 5 }));
		llm.mockResolvedValue('hello');
		const r = await call({ body: { frames } });
		expect(r.status).toBe(200);
		expect(upstream.mock.calls[0][0]).toBe('https://asl.example.test/transcribe');
		expect(r.json).toMatchObject({ text: 'hello', raw: 'helo', cleaned: true });
	});
});

describe('mode: signs', () => {
	it('routes to /recognize-signs and returns the top guesses without the LLM pass', async () => {
		const signs = [{ sign: 'hello', probability: 0.9 }, { sign: 'yes', probability: 0.05 }];
		upstream.mockResolvedValue(reply(200, { signs, confidence: 0.9, frames: 12, ms: 7 }));
		const r = await call({ body: { mode: 'signs', frames } });
		expect(r.status).toBe(200);
		expect(upstream.mock.calls[0][0]).toBe('https://asl.example.test/recognize-signs');
		expect(upstream.mock.calls[0][1].headers.authorization).toBe('Bearer secret');
		expect(r.json.signs).toEqual(signs);
		expect(llm).not.toHaveBeenCalled();
	});
	it('rejects an unknown mode before touching the worker', async () => {
		const r = await call({ body: { mode: 'gestures', frames } });
		expect(r.status).toBe(400);
		expect(r.json.error).toBe('bad_request');
		expect(upstream).not.toHaveBeenCalled();
	});
	it('rejects a body without frames', async () => {
		const r = await call({ body: { mode: 'signs' } });
		expect(r.status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});
	it('shares the per-IP rate limit and answers 429 when it is spent', async () => {
		limit.mockResolvedValue({ success: false, reset: Date.now() + 5000, limit: 30, remaining: 0 });
		const r = await call({ body: { mode: 'signs', frames } });
		expect(r.status).toBe(429);
		expect(upstream).not.toHaveBeenCalled();
	});
	it('reports a worker without the signs model as 503, not a generic failure', async () => {
		upstream.mockResolvedValue(reply(503, { detail: 'signs_model_unavailable' }));
		const r = await call({ body: { mode: 'signs', frames } });
		expect(r.status).toBe(503);
		expect(r.json.error).toBe('signs_unavailable');
	});
	it('maps a worker validation failure to 400 and any other failure to 502', async () => {
		upstream.mockResolvedValueOnce(reply(400, { detail: 'too few frames' }));
		expect((await call({ body: { mode: 'signs', frames } })).status).toBe(400);
		upstream.mockResolvedValueOnce(reply(500, {}));
		expect((await call({ body: { mode: 'signs', frames } })).status).toBe(502);
	});
	it('serves the signs schema from the signs route and caches it separately', async () => {
		const schema = { columns: ['x_face_0'], labels: 250, top_k: 5, max_frames: 1500, min_frames: 8 };
		upstream.mockResolvedValue(reply(200, schema));
		const r = await call({ method: 'GET', query: '?mode=signs' });
		expect(r.status).toBe(200);
		expect(r.json.labels).toBe(250);
		expect(upstream.mock.calls[0][0]).toBe('https://asl.example.test/signs-schema');
		await call({ method: 'GET', query: '?mode=signs' });
		expect(upstream).toHaveBeenCalledTimes(1);
	});
	it('503s with a clear message when the proxy is not configured', async () => {
		delete process.env.GCP_ASL_RECOGNITION_URL;
		const r = await call({ body: { mode: 'signs', frames } });
		expect(r.status).toBe(503);
		expect(r.json.error).toBe('unconfigured');
	});
});
