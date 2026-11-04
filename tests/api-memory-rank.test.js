import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUserMock = vi.fn();
const authenticateBearerMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: (...a) => authenticateBearerMock(...a),
	extractBearer: () => null,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
const rateMock = vi.fn(async () => ({ success: true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { memoryRankUser: (...a) => rateMock(...a) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://localhost:3000', ISSUER: 'http://test', MCP_RESOURCE: 'http://test' },
}));

// Embedder stub at the library boundary: a bag-of-words vector over a tiny vocabulary.
const VOCAB = ['dark', 'mode', 'theme', 'cat', 'miso', 'contrast'];
const vec = (t) => Float64Array.from(VOCAB, (w) => (t.toLowerCase().includes(w) ? 1 : 0));
const configured = vi.fn(() => true);
const embedPassagesAny = vi.fn(async (_pref, texts) => ({ tag: 'test@6', vectors: texts.map(vec) }));
vi.mock('../api/_lib/embeddings.js', async (orig) => ({
	...(await orig()),
	embeddingsConfigured: () => configured(),
	defaultIngestEmbedderTag: () => 'test@6',
	embedPassagesAny: (...a) => embedPassagesAny(...a),
	embedQuery: async (_tag, text) => vec(text),
}));

const { default: handler, clearRankCache } = await import('../api/memory/rank.js');

function mkReq(body, method = 'POST') {
	const buf = Buffer.from(JSON.stringify(body));
	return {
		method,
		url: '/api/memory/rank',
		headers: { 'content-type': 'application/json' },
		on(event, cb) {
			if (event === 'data') queueMicrotask(() => { cb(buf); this._end?.(); });
			else if (event === 'end') this._end = cb;
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}
const run = async (body) => {
	const res = mkRes();
	await handler(mkReq(body), res);
	return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : undefined };
};

beforeEach(() => {
	clearRankCache();
	embedPassagesAny.mockClear();
	configured.mockReturnValue(true);
	rateMock.mockResolvedValue({ success: true });
	getSessionUserMock.mockReset().mockResolvedValue({ id: 'user-1' });
	authenticateBearerMock.mockReset().mockResolvedValue(null);
});

const items = [
	{ id: 'pet.md', text: 'Has a cat called Miso' },
	{ id: 'theme.md', text: 'Prefers dark mode and high contrast theme' },
];

describe('POST /api/memory/rank', () => {
	it('requires sign-in', async () => {
		getSessionUserMock.mockResolvedValue(null);
		const r = await run({ query: 'dark theme', items });
		expect(r.status).toBe(401);
	});

	it('returns items sorted by cosine, best first', async () => {
		const r = await run({ query: 'dark mode theme', items });
		expect(r.status).toBe(200);
		expect(r.json.results.map((x) => x.id)).toEqual(['theme.md', 'pet.md']);
		expect(r.json.results[0].score).toBeGreaterThan(r.json.results[1].score);
		expect(r.json.embedder).toBe('test@6');
	});

	it('rejects oversize and malformed input with 400', async () => {
		expect((await run({ query: 'q', items: Array.from({ length: 65 }, (_, i) => ({ id: `${i}`, text: 'x' })) })).status).toBe(400);
		expect((await run({ query: 'q', items: [{ id: 'a', text: 'x'.repeat(4001) }] })).status).toBe(400);
		expect((await run({ query: '', items })).status).toBe(400);
		expect((await run({ query: 'q', items: [] })).status).toBe(400);
		expect((await run({ query: 'q', items: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] })).status).toBe(400);
	});

	it('answers 503 embeddings_unconfigured when no provider is configured', async () => {
		configured.mockReturnValue(false);
		const r = await run({ query: 'dark', items });
		expect(r.status).toBe(503);
		expect(r.json.error).toBe('embeddings_unconfigured');
	});

	it('answers 503 when the embedder fails', async () => {
		embedPassagesAny.mockRejectedValueOnce(new Error('upstream down'));
		const r = await run({ query: 'dark', items });
		expect(r.status).toBe(503);
		expect(r.json.error).toBe('embedder_unavailable');
	});

	it('re-embeds only changed texts on a repeat call', async () => {
		await run({ query: 'dark', items });
		expect(embedPassagesAny).toHaveBeenCalledTimes(1);
		await run({ query: 'cat', items });
		expect(embedPassagesAny).toHaveBeenCalledTimes(1);
		await run({ query: 'cat', items: [...items, { id: 'new.md', text: 'brand new memory' }] });
		expect(embedPassagesAny).toHaveBeenCalledTimes(2);
		expect(embedPassagesAny.mock.calls[1][1]).toEqual(['brand new memory']);
	});

	it('answers 429 when rate limited', async () => {
		rateMock.mockResolvedValue({ success: false });
		expect((await run({ query: 'dark', items })).status).toBe(429);
	});
});
