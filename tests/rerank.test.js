import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendOpsAlert = vi.fn(async () => {});
const shared = new Map();
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: (...a) => sendOpsAlert(...a) }));
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (shared.has(k) ? shared.get(k) : null),
	cacheSetIfAbsent: async (k, v) => {
		if (shared.has(k)) return false;
		shared.set(k, v);
		return true;
	},
}));

const rerank = await import('../api/_lib/rerank.js');
const { rerankPassages, rerankConfigured, rerankUrl, rerankModel, resetRerankState, DEFAULT_RERANK_MODEL } = rerank;

const PASSAGES = ['paris weather', 'set the rerank flag', 'glb meshes'];

function json(status, body) {
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

beforeEach(() => {
	process.env.NVIDIA_API_KEY = 'nvapi-test';
	delete process.env.KNOWLEDGE_RERANK_ENABLED;
	delete process.env.KNOWLEDGE_RERANK_MODEL;
	shared.clear();
	resetRerankState();
	sendOpsAlert.mockClear();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('configuration', () => {
	it('is on by default with a key, off with KNOWLEDGE_RERANK_ENABLED=0 or no key', () => {
		expect(rerankConfigured()).toBe(true);
		process.env.KNOWLEDGE_RERANK_ENABLED = '0';
		expect(rerankConfigured()).toBe(false);
		delete process.env.KNOWLEDGE_RERANK_ENABLED;
		delete process.env.NVIDIA_API_KEY;
		expect(rerankConfigured()).toBe(false);
	});

	it('pins the live model at its own dotted retrieval URL and honours the override', () => {
		expect(DEFAULT_RERANK_MODEL).toBe('nvidia/nemotron-3.5-rerank-8b');
		expect(rerankUrl()).toBe('https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking');
		process.env.KNOWLEDGE_RERANK_MODEL = 'nvidia/some-next-rerank';
		expect(rerankModel()).toBe('nvidia/some-next-rerank');
		expect(rerankUrl()).toBe('https://ai.api.nvidia.com/v1/retrieval/nvidia/some-next-rerank/reranking');
	});
});

describe('reordering', () => {
	it('returns the upstream best-first order and sends the model it posts to', async () => {
		const fetchMock = vi.fn(async () =>
			json(200, { rankings: [{ index: 1, logit: 2 }, { index: 2, logit: -1 }, { index: 0, logit: -3 }] }),
		);
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('how do I enable it', PASSAGES)).toEqual([1, 2, 0]);
		const [url, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(url).toBe(rerankUrl());
		expect(body.model).toBe(DEFAULT_RERANK_MODEL);
		expect(body.query).toEqual({ text: 'how do I enable it' });
		expect(body.passages).toEqual(PASSAGES.map((text) => ({ text })));
	});

	it('rejects a partial or duplicated ranking', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json(200, { rankings: [{ index: 1 }, { index: 1 }, { index: 0 }] })));
		expect(await rerankPassages('q', PASSAGES)).toBeNull();
		vi.stubGlobal('fetch', vi.fn(async () => json(200, { rankings: [{ index: 1 }, { index: 0 }] })));
		expect(await rerankPassages('q', PASSAGES)).toBeNull();
	});

	it('skips the call for fewer than two passages or an empty query', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', ['one'])).toBeNull();
		expect(await rerankPassages('', PASSAGES)).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('fail-open', () => {
	it('returns null on a 5xx, a 429, a network error or a non-JSON body', async () => {
		for (const impl of [
			async () => json(500, { error: 'boom' }),
			async () => json(429, { error: 'slow down' }),
			async () => {
				throw new TypeError('fetch failed');
			},
			async () => new Response('not json', { status: 200 }),
		]) {
			vi.stubGlobal('fetch', vi.fn(impl));
			expect(await rerankPassages('q', PASSAGES)).toBeNull();
		}
		expect(sendOpsAlert).not.toHaveBeenCalled();
	});

	it('aborts at the hard timeout and returns null', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener('abort', () => reject(init.signal.reason));
					}),
			),
		);
		const started = Date.now();
		expect(await rerankPassages('q', PASSAGES, { timeoutMs: 50 })).toBeNull();
		expect(Date.now() - started).toBeLessThan(1_000);
	});
});

describe('retirement guard', () => {
	for (const status of [404, 410]) {
		it(`disables the stage on ${status}, alerts once, and stops calling upstream`, async () => {
			const fetchMock = vi.fn(async () => json(status, { title: 'Gone', detail: 'end of life' }));
			vi.stubGlobal('fetch', fetchMock);

			expect(await rerankPassages('q', PASSAGES)).toBeNull();
			expect(await rerankPassages('q', PASSAGES)).toBeNull();
			expect(await rerankPassages('q', PASSAGES)).toBeNull();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(sendOpsAlert).toHaveBeenCalledTimes(1);
			const [title, detail, opts] = sendOpsAlert.mock.calls[0];
			expect(title).toContain(String(status));
			expect(title).toContain(DEFAULT_RERANK_MODEL);
			expect(detail).toContain('KNOWLEDGE_RERANK_MODEL');
			expect(opts.signature).toBe(`rerank:model-retired:${DEFAULT_RERANK_MODEL}`);
		});
	}

	it('honours a retirement another instance recorded in the shared cache, without re-alerting', async () => {
		shared.set(`rerank:retired:${DEFAULT_RERANK_MODEL}`, { until: Date.now() + 60_000, status: 410 });
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', PASSAGES)).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(sendOpsAlert).not.toHaveBeenCalled();
	});

	it('a re-pin via KNOWLEDGE_RERANK_MODEL runs immediately despite the old model being retired', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json(410, 'gone')));
		await rerankPassages('q', PASSAGES);
		process.env.KNOWLEDGE_RERANK_MODEL = 'nvidia/next-rerank';
		const fetchMock = vi.fn(async () => json(200, { rankings: [{ index: 2 }, { index: 0 }, { index: 1 }] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', PASSAGES)).toEqual([2, 0, 1]);
		expect(fetchMock.mock.calls[0][0]).toBe(rerankUrl('nvidia/next-rerank'));
	});

	it('resumes after the cool-down lapses', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json(404, 'missing')));
		await rerankPassages('q', PASSAGES);
		shared.clear();
		const later = Date.now() + (rerank.RETIRED_COOLDOWN_S + 1) * 1000;
		vi.spyOn(Date, 'now').mockReturnValue(later);
		const fetchMock = vi.fn(async () => json(200, { rankings: [{ index: 0 }, { index: 1 }, { index: 2 }] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', PASSAGES)).toEqual([0, 1, 2]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
