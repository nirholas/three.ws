import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The vector-space contract of api/_lib/embeddings.js under a model migration.
// The new default NIM embedder (nemotron-3.5-embed-8b) and the one it replaces
// (nemotron-3-embed-1b) both produce 2048-dim vectors, so the old length guard
// in cosine() no longer separates them: only the model@dim tag does. These
// tests drive the real module against a stubbed NIM endpoint and assert that
// no path ever scores a vector against a query from another model.

vi.mock('../api/_lib/provider-health.js', () => ({
	AUTH_COOLDOWN_SECONDS: 300,
	markProviderCooldown: vi.fn(async () => {}),
	clearProviderCooldown: vi.fn(async () => {}),
	providersInCooldown: vi.fn(async () => new Set()),
}));

const health = await import('../api/_lib/provider-health.js');
const emb = await import('../api/_lib/embeddings.js');

// Deterministic, model-specific unit vectors: the same text embeds to a
// different direction in each model, exactly like two real spaces.
function fakeVector(model, text, dim) {
	const seed = [...`${model}|${text}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
	const v = new Array(dim);
	let s = seed;
	for (let i = 0; i < dim; i++) {
		s = (s * 1103515245 + 12345) >>> 0;
		v[i] = (s / 2 ** 32) * 2 - 1;
	}
	const n = Math.hypot(...v);
	return v.map((x) => x / n);
}

let calls;
let refuse;
let down;
beforeEach(() => {
	calls = [];
	refuse = new Set();
	down = new Set();
	process.env.NVIDIA_API_KEY = 'test-key';
	delete process.env.GOOGLE_CLOUD_PROJECT;
	delete process.env.OPENAI_API_KEY;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			const body = JSON.parse(init.body);
			calls.push(body);
			if (down.has(body.model)) return new Response('{"detail":"rate limited"}', { status: 429 });
			if (body.input.some((t) => refuse.has(`${body.model}|${t}`))) {
				return new Response('{"detail":"input rejected by content safety screening"}', { status: 422 });
			}
			const dim = body.dimensions || 2048;
			return Response.json({
				data: body.input.map((t, index) => ({ index, embedding: fakeVector(body.model, t, dim) })),
			});
		}),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.NVIDIA_API_KEY;
});

const NEW = emb.NIM_EMBED_TAG;
const OLD = emb.NIM_EMBED_TAG_PREVIOUS;

describe('the migration registry', () => {
	it('defaults new ingest to nemotron-3.5-embed-8b and keeps the replaced model live behind it', () => {
		expect(NEW).toBe('nvidia/nemotron-3.5-embed-8b@2048');
		expect(OLD).toBe('nvidia/nemotron-3-embed-1b@2048');
		expect(emb.defaultIngestEmbedderTag()).toBe(NEW);
		expect(emb.embedderConfigured(OLD)).toBe(true);
		// Same dimension, different spaces: the tag is the only thing telling them apart.
		expect(emb.embedderInfo(NEW).dim).toBe(emb.embedderInfo(OLD).dim);
	});

	it('asks NIM for the reduced Matryoshka dimension only on the model that supports it', async () => {
		await emb.embedWith(NEW, ['a'], 'passage');
		await emb.embedWith(OLD, ['a'], 'passage');
		expect(calls[0]).toMatchObject({ model: 'nvidia/nemotron-3.5-embed-8b', dimensions: 2048, input_type: 'passage' });
		expect(calls[1].model).toBe('nvidia/nemotron-3-embed-1b');
		expect(calls[1]).not.toHaveProperty('dimensions');
	});
});

describe('scoreRowsBySpace with two same-dimension models', () => {
	const query = 'what did the agent learn about my wallet';

	it('scores every row only against a query embedded by that row\'s own model', async () => {
		const rows = [
			{ id: 'n1', embedder: NEW, embedding: fakeVector('nvidia/nemotron-3.5-embed-8b', query, 2048) },
			{ id: 'o1', embedder: OLD, embedding: fakeVector('nvidia/nemotron-3-embed-1b', query, 2048) },
			{ id: 'n2', embedder: NEW, embedding: fakeVector('nvidia/nemotron-3.5-embed-8b', 'unrelated', 2048) },
		];
		const { scored, needsReembed } = await emb.scoreRowsBySpace(rows, query);
		expect(needsReembed).toEqual([]);
		const byId = Object.fromEntries(scored.map((r) => [r.id, r]));
		// A row embedded from the query text in its own space scores 1. Scoring it
		// against the other model's query vector would land near 0.
		expect(byId.n1.score).toBeCloseTo(1, 6);
		expect(byId.o1.score).toBeCloseTo(1, 6);
		expect(byId.n2.score).toBeLessThan(0.2);
		const queryCalls = calls.filter((c) => c.input_type === 'query');
		expect(queryCalls.map((c) => c.model).sort()).toEqual(['nvidia/nemotron-3-embed-1b', 'nvidia/nemotron-3.5-embed-8b']);
	});

	it('never scores a row whose vector length contradicts its tag, and reports it for re-embedding', async () => {
		const rows = [
			{ id: 'bad', embedder: NEW, embedding: fakeVector('x', 'y', 1024) },
			{ id: 'ok', embedder: NEW, embedding: fakeVector('nvidia/nemotron-3.5-embed-8b', query, 2048) },
		];
		const { scored, needsReembed } = await emb.scoreRowsBySpace(rows, query);
		expect(scored.map((r) => r.id)).toEqual(['ok']);
		expect(needsReembed).toEqual([{ embedder: NEW, chunks: 1, reason: 'dimension_mismatch' }]);
	});
});

describe('cosineInSpace', () => {
	it('refuses to compare two vectors from different models even when their lengths match', () => {
		const a = fakeVector('m', 'a', 2048);
		expect(() => emb.cosineInSpace({ tag: NEW, vector: a }, { tag: OLD, vector: a })).toThrow(/different vector spaces/);
		expect(emb.cosineInSpace({ tag: NEW, vector: a }, { tag: NEW, vector: a })).toBeCloseTo(1, 6);
	});
});

describe('content-safety refusals', () => {
	it('surface as content_refused and do not put a healthy lane into cooldown', async () => {
		refuse.add('nvidia/nemotron-3.5-embed-8b|curl -H Bearer');
		await expect(emb.embedWith(NEW, ['curl -H Bearer'], 'passage')).rejects.toMatchObject({ code: 'content_refused' });
		const res = await emb.embedPassagesAny(NEW, ['curl -H Bearer']);
		expect(res.tag).toBe(OLD);
		expect(health.markProviderCooldown).not.toHaveBeenCalled();
	});

	it('embedPassagesEach keeps every accepted text in the preferred space and moves only the refused one', async () => {
		refuse.add('nvidia/nemotron-3.5-embed-8b|refused text');
		const out = await emb.embedPassagesEach(NEW, ['alpha', 'refused text', 'beta']);
		expect(out.map((r) => r.tag)).toEqual([NEW, OLD, NEW]);
		for (const r of out) expect(r.vector).toHaveLength(2048);
	});

	it('strict mode throws on a lane outage instead of demoting the batch to the previous model', async () => {
		// A re-embed must never rewrite rows into the old space because of a 429.
		down.add('nvidia/nemotron-3.5-embed-8b');
		const loose = await emb.embedPassagesEach(NEW, ['alpha', 'beta']);
		expect(loose.map((r) => r.tag)).toEqual([OLD, OLD]);
		await expect(emb.embedPassagesEach(NEW, ['alpha', 'beta'], { strict: true })).rejects.toMatchObject({ status: 429 });
	});

	it('strict mode still moves a content refusal to the next lane', async () => {
		refuse.add('nvidia/nemotron-3.5-embed-8b|refused text');
		const out = await emb.embedPassagesEach(NEW, ['alpha', 'refused text'], { strict: true });
		expect(out.map((r) => r.tag)).toEqual([NEW, OLD]);
	});
});
