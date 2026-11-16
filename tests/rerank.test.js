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
	process.env.KNOWLEDGE_RERANK_ENABLED = '1';
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
	it('is opt-in: on only with KNOWLEDGE_RERANK_ENABLED=1 and a key', () => {
		expect(rerankConfigured()).toBe(true);
		delete process.env.KNOWLEDGE_RERANK_ENABLED;
		expect(rerankConfigured()).toBe(false);
		process.env.KNOWLEDGE_RERANK_ENABLED = '0';
		expect(rerankConfigured()).toBe(false);
		process.env.KNOWLEDGE_RERANK_ENABLED = '1';
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

describe('content-safety rejection', () => {
	// The hosted endpoint rejects the WHOLE batch with 422 when any one passage
	// trips its safety screen (9 of 652 docs chunks did in the 2026-11-16 eval,
	// which sank 7 of 48 twelve-passage pools). Pair logits do not depend on the
	// batch, so scoring each passage alone and merging by logit is exact.
	const SAFETY = { error: { message: 'input rejected by content safety screening' } };
	const four = ['a cosine first', 'b flagged', 'c best match', 'd middling'];
	const logits = { 'a cosine first': -3, 'c best match': 2, 'd middling': -1 };

	function safetyFetch() {
		return vi.fn(async (_url, init) => {
			const { passages } = JSON.parse(init.body);
			if (passages.some((p) => p.text.includes('flagged'))) return json(422, SAFETY);
			if (passages.length > 1) return json(500, 'unexpected batch');
			return json(200, { rankings: [{ index: 0, logit: logits[passages[0].text] }] });
		});
	}

	it('rescores passages one by one and keeps a flagged passage in its cosine slot', async () => {
		const fetchMock = safetyFetch();
		vi.stubGlobal('fetch', fetchMock);
		const trace = {};
		expect(await rerankPassages('q', four, { trace })).toEqual([2, 1, 3, 0]);
		expect(fetchMock).toHaveBeenCalledTimes(1 + four.length);
		expect(trace).toMatchObject({ path: 'split', flagged: 1 });
		expect(sendOpsAlert).not.toHaveBeenCalled();
	});

	it('returns null when the query itself is rejected (every passage flagged)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json(422, SAFETY)));
		expect(await rerankPassages('q', four)).toBeNull();
	});

	it('does not treat a safety 422 as a retirement', async () => {
		vi.stubGlobal('fetch', safetyFetch());
		await rerankPassages('q', four);
		const fetchMock = vi.fn(async () => json(200, { rankings: [{ index: 1 }, { index: 0 }, { index: 2 }] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', PASSAGES)).toEqual([1, 0, 2]);
	});
});

describe('hedging', () => {
	it('fires a second request when the first is slow and uses whichever answers first', async () => {
		let calls = 0;
		const fetchMock = vi.fn((_url, init) => {
			calls++;
			if (calls === 1) {
				return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
			}
			return Promise.resolve(json(200, { rankings: [{ index: 2 }, { index: 1 }, { index: 0 }] }));
		});
		vi.stubGlobal('fetch', fetchMock);
		const trace = {};
		expect(await rerankPassages('q', PASSAGES, { hedgeAfterMs: 20, trace })).toEqual([2, 1, 0]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(trace.hedged).toBe(true);
	});

	it('uses the hedge as one retry when the first request fails fast with a 5xx', async () => {
		let calls = 0;
		const fetchMock = vi.fn(async () =>
			++calls === 1 ? json(503, 'busy') : json(200, { rankings: [{ index: 0 }, { index: 2 }, { index: 1 }] }),
		);
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', PASSAGES, { hedgeAfterMs: 5_000 })).toEqual([0, 2, 1]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('never sends more than two requests for one batch', async () => {
		const fetchMock = vi.fn(async () => json(503, 'busy'));
		vi.stubGlobal('fetch', fetchMock);
		expect(await rerankPassages('q', PASSAGES, { hedgeAfterMs: 1 })).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
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
