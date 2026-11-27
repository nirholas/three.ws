/**
 * The quality stage as the Forge handlers actually run it, driven through the
 * real /api/forge and /api/gpt-forge handlers with only the network boundaries
 * (NVIDIA, Hugging Face, the store, the vision judge, the shared cache) stubbed.
 *
 * The stage's own rules are pinned in tests/forge-quality-stage.test.js. This
 * file proves the two synchronous lanes (free NVIDIA NIM text-to-3D and the
 * Hugging Face Spaces photo lane) obey them end to end:
 *
 *   - at most ONE automatic regeneration per request, whatever asked for it
 *     (the structural retry and the vision retry used to stack: three
 *     generations for one request);
 *   - the better of the two results is delivered, never simply the newest;
 *   - the regeneration is not counted again (no second funnel start or done);
 *   - no regeneration when the caller is at the edge of their allowance or the
 *     lane is busy;
 *   - a judge that hangs, throws or answers nonsense never blocks or rerolls a
 *     delivered model, and the time it can add is bounded;
 *   - the response says what happened.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// A short scoring budget so the hang test proves the bound quickly. Set before
// any import, because the stage reads its limits once at module load.
vi.hoisted(() => {
	process.env.FORGE_QUALITY_STAGE_BUDGET_MS = '300';
});

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		NVIDIA_API_KEY: 'test-nvidia-key',
		HF_TOKEN: 'test-hf-token',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
		// Every model the judge sees is scored, so the vision retry path is live.
		FORGE_QUALITY_GATE: 'all',
	});
	delete process.env.GCP_HUNYUAN3D_URL;
	delete process.env.GCP_RECONSTRUCTION_KEY;
	delete process.env.FORGE_QUALITY_GATE_MAX_RETRIES;
});

const cacheStore = new Map();
vi.mock('../../api/_lib/cache.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		cacheGet: vi.fn(async (key) => (cacheStore.has(key) ? cacheStore.get(key) : null)),
		cacheSet: vi.fn(async (key, value) => {
			cacheStore.set(key, value);
		}),
		cacheDel: vi.fn(async (key) => cacheStore.delete(key)),
		acquireLock: vi.fn(async () => true),
		releaseLock: vi.fn(async () => {}),
	};
});

// Each generation hands back a distinct GLB so the test can tell which attempt
// was delivered.
let generation = 0;
const nvTextTo3d = vi.fn(async () => {
	generation += 1;
	return { resultGlbUrl: `https://cdn.example/nv-${generation}.glb` };
});
vi.mock('../../api/_providers/nvidia.js', () => ({
	createNvidiaProvider: () => ({ textTo3d: nvTextTo3d, status: vi.fn() }),
}));

let hfGeneration = 0;
const hfSubmit = vi.fn(async () => {
	hfGeneration += 1;
	return { extJobId: `hf-job-${hfGeneration}` };
});
const hfStatus = vi.fn(async (extJobId) => ({ status: 'done', resultGlbUrl: `https://cdn.example/${extJobId}.glb` }));
vi.mock('../../api/_providers/huggingface.js', () => ({
	createRegenProvider: () => ({ submit: hfSubmit, status: hfStatus }),
}));

vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({ submit: vi.fn(async () => ({ extJobId: 'rep-job-1234567890' })) }),
}));
vi.mock('../../api/_mcp3d/text-to-image.js', async (importActual) => ({
	...(await importActual()),
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
}));
vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

// The structural score each delivered attempt gets, in delivery order.
let qualityQueue = [];
const createCreation = vi.fn(async ({ replicateJobId }) => `row-${replicateJobId}`);
const materializeCreation = vi.fn(async ({ replicateJobId, glbUrl }) => ({
	id: `row-${replicateJobId}`,
	glbUrl,
	quality: qualityQueue.length ? qualityQueue.shift() : { flag: 'ok', score: 0.9 },
}));
const retireAttempt = vi.fn(async () => true);
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: (...a) => createCreation(...a),
	materializeCreation: (...a) => materializeCreation(...a),
	retireAttempt: (...a) => retireAttempt(...a),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

// The vision judge, keyed by the GLB it is asked about.
const verdicts = new Map();
const judgeByUrl = async ({ glbUrl }) => verdicts.get(glbUrl) ?? PASS(80);
const runQualityGate = vi.fn(judgeByUrl);
vi.mock('../../api/_lib/forge-quality-gate.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, runQualityGate: (...a) => runQualityGate(...a) };
});

let allowanceRemaining = 10;
const allowance = () => ({ success: true, limit: 10, remaining: allowanceRemaining, reset: Date.now() + 1000 });
vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => allowance()),
			mcp3dGenerateFree: vi.fn(async () => allowance()),
			mcp3dGenerateFreeTiered: vi.fn(async () => allowance()),
			mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.24',
	};
});

// Slot gate: the first acquisition is the lane's own; later ones are the retry.
let retrySlotFree = true;
let slotCalls = 0;
vi.mock('../../api/_lib/forge-scale.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		acquireBlockingSlot: vi.fn(async () => {
			slotCalls += 1;
			const ok = slotCalls === 1 || retrySlotFree;
			return { ok, release: async () => {} };
		}),
	};
});

const PASS = (score) => ({ pass: true, score, defects: [], qa_available: true, reason: 'ok' });
const FAIL = (score) => ({ pass: false, score, defects: ['blob'], qa_available: true, reason: 'blobby', suggested_retry_hint: 'cleaner geometry' });
const BROKEN = { flag: 'degenerate', score: 0.05 };
const LOW = { flag: 'low', score: 0.2 };

const handlers = {
	forge: (await import('../../api/forge.js')).default,
	'gpt-forge': (await import('../../api/gpt-forge.js')).default,
};

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		getHeader(name) {
			return this.headers[String(name).toLowerCase()];
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

async function call(which, body) {
	const req = {
		method: 'POST',
		url: `/api/${which}`,
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'x-client-region': 'US' },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
	const res = makeRes();
	await handlers[which](req, res);
	return res;
}

const textPrompt = (which) =>
	call(which, { prompt: 'a red ceramic coffee mug', backend: 'nvidia', tier: 'standard', path: 'image' });
const photo = (which) =>
	call(which, {
		image_urls: ['https://cdn.example/photo.png'],
		backend: 'huggingface',
		tier: 'standard',
		path: 'image',
		skip_validation: true,
	});

beforeEach(() => {
	vi.clearAllMocks();
	runQualityGate.mockImplementation(judgeByUrl);
	cacheStore.clear();
	verdicts.clear();
	qualityQueue = [];
	generation = 0;
	hfGeneration = 0;
	allowanceRemaining = 10;
	retrySlotFree = true;
	slotCalls = 0;
});

for (const which of ['forge', 'gpt-forge']) {
	describe(`/api/${which}: NVIDIA NIM text lane`, () => {
		it('regenerates at most once when both the structure check and the judge flag the model', async () => {
			qualityQueue = [BROKEN, BROKEN, BROKEN];
			verdicts.set('https://cdn.example/nv-1.glb', FAIL(20));
			verdicts.set('https://cdn.example/nv-2.glb', FAIL(25));
			verdicts.set('https://cdn.example/nv-3.glb', FAIL(30));
			const res = await textPrompt(which);
			expect(res.statusCode).toBe(200);
			expect(nvTextTo3d).toHaveBeenCalledTimes(2);
			expect(res.body.quality_retried).toBe(true);
		});

		it('delivers the better attempt, not the newest, when the regeneration is worse', async () => {
			qualityQueue = [LOW, BROKEN];
			const res = await textPrompt(which);
			expect(nvTextTo3d).toHaveBeenCalledTimes(2);
			expect(res.body.glb_url).toBe('https://cdn.example/nv-1.glb');
			expect(res.body.quality_retry).toMatchObject({ ran: true, kept: 'first' });
			// The attempt nobody was shown does not linger in their library.
			expect(retireAttempt).toHaveBeenCalledTimes(1);
			expect(retireAttempt.mock.calls[0][0].id).toBe(`row-${materializeCreation.mock.calls[1][0].replicateJobId}`);
		});

		it('does not count the regeneration as a second generation', async () => {
			qualityQueue = [BROKEN, { flag: 'ok', score: 0.9 }];
			const res = await textPrompt(which);
			expect(res.body.glb_url).toBe('https://cdn.example/nv-2.glb');
			expect(createCreation).toHaveBeenCalledTimes(2);
			expect(createCreation.mock.calls[0][0].recordStart).not.toBe(false);
			expect(createCreation.mock.calls[1][0].recordStart).toBe(false);
			expect(materializeCreation.mock.calls[0][0].recordEvent).not.toBe(false);
			expect(materializeCreation.mock.calls[1][0].recordEvent).toBe(false);
			expect(res.body.quality_retry).toMatchObject({ ran: true, kept: 'retry' });
			expect(res.body.quality_retry.message).toMatch(/regenerated once/i);
		});

		it('does not regenerate for a caller at the edge of their allowance, and says why', async () => {
			allowanceRemaining = 0;
			qualityQueue = [BROKEN];
			const res = await textPrompt(which);
			expect(res.statusCode).toBe(200);
			expect(nvTextTo3d).toHaveBeenCalledTimes(1);
			expect(res.body.glb_url).toBe('https://cdn.example/nv-1.glb');
			expect(res.body.quality_retry).toMatchObject({ ran: false, declined: 'allowance' });
			expect(res.body.quality_retry.message).toMatch(/limit/i);
		});

		it('does not regenerate while the NIM lane is cooling down', async () => {
			qualityQueue = [BROKEN];
			// The lane cooled between the first generation and the retry decision.
			nvTextTo3d.mockImplementationOnce(async () => {
				generation += 1;
				cacheStore.set('llm-cooldown:forge-nim-trellis', { reason: 'health', until: Date.now() + 60_000 });
				return { resultGlbUrl: `https://cdn.example/nv-${generation}.glb` };
			});
			const res = await textPrompt(which);
			expect(nvTextTo3d).toHaveBeenCalledTimes(1);
			expect(res.body.quality_retry).toMatchObject({ ran: false, declined: 'busy' });
		});

		it('delivers the model inside the scoring budget when the judge hangs', async () => {
			runQualityGate.mockImplementation(() => new Promise(() => {}));
			const t0 = Date.now();
			const res = await textPrompt(which);
			expect(Date.now() - t0).toBeLessThan(3000);
			expect(res.statusCode).toBe(200);
			expect(res.body.glb_url).toBe('https://cdn.example/nv-1.glb');
			expect(nvTextTo3d).toHaveBeenCalledTimes(1);
			expect(res.body.quality_gate?.qa_available).toBe(false);
		});

		it('delivers the model when the judge throws', async () => {
			runQualityGate.mockRejectedValueOnce(new Error('vision chain down'));
			const res = await textPrompt(which);
			expect(res.statusCode).toBe(200);
			expect(res.body.glb_url).toBe('https://cdn.example/nv-1.glb');
			expect(nvTextTo3d).toHaveBeenCalledTimes(1);
		});

		it('does not regenerate on a nonsense verdict (a fail with no score)', async () => {
			verdicts.set('https://cdn.example/nv-1.glb', { pass: false });
			const res = await textPrompt(which);
			expect(res.statusCode).toBe(200);
			expect(nvTextTo3d).toHaveBeenCalledTimes(1);
			expect(res.body.glb_url).toBe('https://cdn.example/nv-1.glb');
		});
	});

	describe(`/api/${which}: Hugging Face photo lane`, () => {
		it('regenerates at most once when both checks flag the model', async () => {
			qualityQueue = [BROKEN, BROKEN, BROKEN];
			verdicts.set('https://cdn.example/hf-job-1.glb', FAIL(20));
			verdicts.set('https://cdn.example/hf-job-2.glb', FAIL(25));
			const res = await photo(which);
			expect(res.statusCode).toBe(200);
			expect(hfSubmit).toHaveBeenCalledTimes(2);
		});

		it('does not regenerate when no Spaces slot is free, and says the service is busy', async () => {
			retrySlotFree = false;
			qualityQueue = [BROKEN];
			const res = await photo(which);
			expect(hfSubmit).toHaveBeenCalledTimes(1);
			expect(res.body.quality_retry).toMatchObject({ ran: false, declined: 'busy' });
		});

		it('keeps the better attempt and does not count the regeneration twice', async () => {
			qualityQueue = [LOW, BROKEN];
			const res = await photo(which);
			expect(hfSubmit).toHaveBeenCalledTimes(2);
			expect(res.body.glb_url).toBe('https://cdn.example/hf-job-1.glb');
			expect(createCreation.mock.calls[1][0].recordStart).toBe(false);
			expect(materializeCreation.mock.calls[1][0].recordEvent).toBe(false);
		});
	});
}
