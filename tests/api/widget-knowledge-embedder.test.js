// Tests for the embedder-tagging plumbing in api/widgets/[id]/_knowledge.js:
// ingest stamps the free-first embedder tag on the doc and every chunk,
// the retrieval debugger surfaces an actionable needs_reembed 503 instead of
// ever crossing vector spaces, and the QStash worker re-resolves a stale tag
// to a servable embedder before re-embedding.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const NIM_TAG = 'nvidia/nv-embedqa-e5-v5@1024';
const LEGACY_TAG = 'text-embedding-3-small@256';

// ── Mocks (registered before importing _knowledge.js) ───────────────────────

const sqlQueue = [];
const sqlCalls = [];
const sqlMock = vi.fn((strings, ...params) => {
	sqlCalls.push({ text: Array.isArray(strings) ? strings.join('$') : String(strings), params });
	const next = sqlQueue.shift();
	if (next instanceof Error) return Promise.reject(next);
	return Promise.resolve(next ?? []);
});
sqlMock.transaction = vi.fn(async (queries) => Promise.all(queries));
vi.mock('../../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

// Mutable embedding-provider state each test configures.
const mockEmbedState = {
	defaultTag: NIM_TAG,
	configured: new Set([NIM_TAG]),
	scoreResult: { scored: [], needsReembed: [] },
};
// The default model's content screen refuses some passages with a 422; the
// fallback lane accepts them. REFUSED marks the text the screen rejects.
const FALLBACK_TAG = 'nvidia/nemotron-3-embed-1b@2048';
const REFUSED = /curl -H/;
const refusal = () => Object.assign(new Error('NIM embeddings 422: content safety screening'), { code: 'content_refused', status: 422 });
const embedPassagesMock = vi.fn(async (_tag, texts) => {
	if (texts.some((t) => REFUSED.test(t))) throw refusal();
	return texts.map(() => Float64Array.from([1, 0, 0, 0]));
});
const embedPassagesEachMock = vi.fn(async (tag, texts) =>
	texts.map((t) => ({ tag: REFUSED.test(t) ? FALLBACK_TAG : tag, vector: Float64Array.from([1, 0, 0, 0]) })),
);
vi.mock('../../api/_lib/embeddings.js', () => ({
	NIM_EMBED_TAG: NIM_TAG,
	OPENAI_EMBED_TAG: LEGACY_TAG,
	LEGACY_EMBED_TAG: LEGACY_TAG,
	embeddingsConfigured: () => mockEmbedState.configured.size > 0,
	embedderConfigured: (tag) => mockEmbedState.configured.has(tag || LEGACY_TAG),
	defaultIngestEmbedderTag: () => mockEmbedState.defaultTag,
	resolveEmbedderTag: (tag) => {
		const t = tag || LEGACY_TAG;
		return t === NIM_TAG || t === LEGACY_TAG ? t : null;
	},
	embedPassages: embedPassagesMock,
	embedPassagesEach: embedPassagesEachMock,
	scoreRowsBySpace: vi.fn(async () => mockEmbedState.scoreResult),
}));

vi.mock('../../api/_lib/rerank.js', () => ({
	rerankConfigured: () => false,
	rerankPassages: vi.fn(),
}));

vi.mock('../../api/_lib/text-extract.js', () => ({ fetchAndExtract: vi.fn() }));
vi.mock('../../api/_lib/qstash.js', () => ({
	qstashEnabled: () => false,
	publishJob: vi.fn(),
}));
vi.mock('../../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'https://three.ws' } }));

const { ingestKnowledge, testRetrieval, processQueuedDoc } = await import(
	'../../api/widgets/[id]/_knowledge.js'
);

beforeEach(() => {
	sqlQueue.length = 0;
	sqlCalls.length = 0;
	sqlMock.mockClear();
	embedPassagesMock.mockClear();
	embedPassagesEachMock.mockClear();
	mockEmbedState.defaultTag = NIM_TAG;
	mockEmbedState.configured = new Set([NIM_TAG]);
	mockEmbedState.scoreResult = { scored: [], needsReembed: [] };
});

function findCall(snippet) {
	return sqlCalls.find((c) => c.text.includes(snippet));
}

describe('ingestKnowledge — embedder tagging', () => {
	it('stamps the free-first embedder tag on the doc and every chunk', async () => {
		sqlQueue.push([{ n: 0 }]); // doc count
		sqlQueue.push([]); // doc insert
		// chunk inserts run via sql.transaction (mock resolves them), then:
		sqlQueue.push([]); // status=ready update

		const out = await ingestKnowledge({
			widgetId: 'wdgt_x',
			userId: 'user-1',
			input: { source_type: 'text', content: 'three.ws is an agent platform. '.repeat(4), title: 'About' },
		});

		expect(out.status).toBe('ready');
		// Chunks embedded as passages, in the NIM space.
		expect(embedPassagesEachMock).toHaveBeenCalledTimes(1);
		expect(embedPassagesEachMock.mock.calls[0][0]).toBe(NIM_TAG);
		// Doc row carries the tag…
		const docInsert = findCall('insert into widget_knowledge_docs');
		expect(docInsert.params).toContain(NIM_TAG);
		// …and so does every chunk row.
		const chunkInserts = sqlCalls.filter((c) => c.text.includes('insert into widget_knowledge_chunks'));
		expect(chunkInserts.length).toBeGreaterThan(0);
		for (const call of chunkInserts) expect(call.params).toContain(NIM_TAG);
	});

	it('stores a chunk the content screen refused in the fallback space instead of failing the upload', async () => {
		sqlQueue.push([{ n: 0 }]); // doc count
		sqlQueue.push([]); // doc insert
		sqlQueue.push([]); // status=ready update

		const out = await ingestKnowledge({
			widgetId: 'wdgt_x',
			userId: 'user-1',
			input: { source_type: 'text', content: 'Call the API with curl -H "Authorization: Bearer $KEY" to list agents.', title: 'API' },
		});

		expect(out.status).toBe('ready');
		const chunkInserts = sqlCalls.filter((c) => c.text.includes('insert into widget_knowledge_chunks'));
		expect(chunkInserts).toHaveLength(1);
		expect(chunkInserts[0].params).toContain(FALLBACK_TAG);
		expect(chunkInserts[0].params).not.toContain(NIM_TAG);
	});

	it('503s with an actionable message when no embedding provider is configured', async () => {
		mockEmbedState.defaultTag = null;
		mockEmbedState.configured = new Set();
		await expect(
			ingestKnowledge({
				widgetId: 'wdgt_x',
				userId: 'user-1',
				input: { source_type: 'text', content: 'some content here', title: 'T' },
			}),
		).rejects.toMatchObject({ status: 503, code: 'embedder_unavailable' });
		expect(embedPassagesEachMock).not.toHaveBeenCalled();
	});
});

describe('testRetrieval — same-space routing and cross-space refusal', () => {
	it('returns space-scored results with each chunk’s embedder tag', async () => {
		const rows = [
			{ id: 1, doc_id: 'wkd_a', chunk_index: 0, content: 'alpha content', embedding: [1, 0], token_count: 3, embedder: NIM_TAG, title: 'Doc', source_url: null, source_type: 'text' },
		];
		sqlQueue.push(rows);
		mockEmbedState.scoreResult = {
			scored: rows.map((r) => ({ ...r, score: 0.91 })),
			needsReembed: [],
		};
		const out = await testRetrieval({ widgetId: 'wdgt_x', query: 'alpha?', topK: 5 });
		expect(out.results).toHaveLength(1);
		expect(out.results[0]).toMatchObject({ id: 1, embedder: NIM_TAG, score: 0.91 });
		expect(out.reranked).toBe(false);
		expect(out.needs_reembed).toBeUndefined();
	});

	it('refuses with a designed needs_reembed 503 when no stored space is servable', async () => {
		sqlQueue.push([
			{ id: 1, doc_id: 'wkd_a', chunk_index: 0, content: 'legacy', embedding: [1, 0], token_count: 2, embedder: LEGACY_TAG, title: 'Doc', source_url: null, source_type: 'text' },
		]);
		mockEmbedState.scoreResult = {
			scored: [],
			needsReembed: [{ embedder: LEGACY_TAG, chunks: 1 }],
		};
		await expect(testRetrieval({ widgetId: 'wdgt_x', query: 'anything' })).rejects.toMatchObject({
			status: 503,
			code: 'needs_reembed',
		});
		await expect(
			(async () => {
				sqlQueue.push([{ id: 1, doc_id: 'wkd_a', chunk_index: 0, content: 'legacy', embedding: [1, 0], token_count: 2, embedder: LEGACY_TAG, title: 'Doc', source_url: null, source_type: 'text' }]);
				return testRetrieval({ widgetId: 'wdgt_x', query: 'anything' });
			})(),
		).rejects.toThrow(/reembed-widget-knowledge\.mjs/);
	});

	it('serves what it can and reports the rest when spaces are mixed', async () => {
		const nimRow = { id: 1, doc_id: 'wkd_a', chunk_index: 0, content: 'served', embedding: [1, 0], token_count: 2, embedder: NIM_TAG, title: 'Doc', source_url: null, source_type: 'text' };
		sqlQueue.push([nimRow, { ...nimRow, id: 2, embedder: LEGACY_TAG }]);
		mockEmbedState.scoreResult = {
			scored: [{ ...nimRow, score: 0.8 }],
			needsReembed: [{ embedder: LEGACY_TAG, chunks: 1 }],
		};
		const out = await testRetrieval({ widgetId: 'wdgt_x', query: 'served?' });
		expect(out.results.map((r) => r.id)).toEqual([1]);
		expect(out.needs_reembed).toEqual([{ embedder: LEGACY_TAG, chunks: 1 }]);
	});

	it('503s when no embedding provider exists at all', async () => {
		mockEmbedState.configured = new Set();
		await expect(testRetrieval({ widgetId: 'wdgt_x', query: 'q' })).rejects.toMatchObject({
			status: 503,
			code: 'embedder_unavailable',
		});
	});
});

describe('processQueuedDoc — worker re-resolves the embedder', () => {
	it('re-embeds with the current default when the queued tag is no longer servable', async () => {
		// Doc queued under the legacy OpenAI tag, but only NIM is configured now.
		sqlQueue.push([
			{ id: 'wkd_a', widget_id: 'wdgt_x', source_text: 'fresh knowledge text for the worker', status: 'queued', chunk_count: 1, embedder: LEGACY_TAG },
		]);
		sqlQueue.push([]); // status=processing
		sqlQueue.push([]); // delete partial chunks
		// chunk inserts via transaction, then:
		sqlQueue.push([]); // ready update

		const out = await processQueuedDoc({ docId: 'wkd_a', widgetId: 'wdgt_x' });
		expect(out.status).toBe('ready');
		expect(embedPassagesEachMock.mock.calls[0][0]).toBe(NIM_TAG);
		// The ready update writes the tag that was ACTUALLY used.
		const readyUpdate = findCall("status = 'ready'");
		expect(readyUpdate.params).toContain(NIM_TAG);
	});

	it('keeps the queued tag when its provider can still serve', async () => {
		mockEmbedState.configured = new Set([NIM_TAG, LEGACY_TAG]);
		sqlQueue.push([
			{ id: 'wkd_a', widget_id: 'wdgt_x', source_text: 'fresh knowledge text for the worker', status: 'queued', chunk_count: 1, embedder: LEGACY_TAG },
		]);
		sqlQueue.push([]); // status=processing
		sqlQueue.push([]); // delete partial chunks
		sqlQueue.push([]); // ready update

		await processQueuedDoc({ docId: 'wkd_a', widgetId: 'wdgt_x' });
		expect(embedPassagesEachMock.mock.calls[0][0]).toBe(LEGACY_TAG);
	});

	it('fails the doc cleanly when nothing can embed', async () => {
		mockEmbedState.defaultTag = null;
		mockEmbedState.configured = new Set();
		sqlQueue.push([
			{ id: 'wkd_a', widget_id: 'wdgt_x', source_text: 'text body for the doc', status: 'queued', chunk_count: 1, embedder: NIM_TAG },
		]);
		sqlQueue.push([]); // failed update
		await expect(processQueuedDoc({ docId: 'wkd_a', widgetId: 'wdgt_x' })).rejects.toMatchObject({
			status: 503,
			code: 'embedder_unavailable',
		});
		const failedUpdate = findCall("status = 'failed'");
		expect(failedUpdate).toBeTruthy();
	});
});
