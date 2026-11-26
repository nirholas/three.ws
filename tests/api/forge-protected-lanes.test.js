/**
 * Protected Forge lanes, pinned.
 *
 * Owner directive 2026-11-26 (docs/ops/forge-protected-lanes.md): a Forge lane
 * that is measurably working is never switched, reordered, re-tuned, swapped or
 * redeployed while fixing something else. The self-hosted TRELLIS lane
 * (`trellis_selfhost`, workers/model-trellis) carries most Forge jobs and is
 * protected by name; the keyless text-to-image rung (Pollinations) in
 * api/_mcp3d/text-to-image.js is protected in position.
 *
 * A rule in a document stops careful people. These tests stop everyone else:
 * each one fails the moment someone moves the lane in the chain, changes its
 * entry, re-tunes its quality budgets, changes the request the worker receives,
 * changes how its job is polled, or slides a new image rung ahead of the keyless
 * one. Changing what they pin is allowed only with the owner's explicit yes, and
 * then the expected values here are edited deliberately in the same commit.
 *
 * Only the network boundary is stubbed: the outbound fetch, plus the modules
 * that wrap a cloud SDK call or a database write (auth, the creation store, the
 * Vertex client, the Livepeer client, image persistence, the shared rate and
 * cooldown stores).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Network-boundary stubs (hoisted) ─────────────────────────────────────────

// POST /api/forge needs a signed-in account; the pinned request lives past it.
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-protected-lanes-user' }),
}));

// The creation store writes to Postgres.
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-protected-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-protected-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

// Photo validation downloads the image; the photo here is a fixed input.
vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

// The rate limiter talks to the shared store.
vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const allow = vi.fn(async () => ({ success: true, reset: Date.now() + 1000 }));
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: allow,
			mcp3dGenerateFree: allow,
			mcp3dGenerateFreeTiered: allow,
		},
		clientIp: () => '203.0.113.106',
	};
});

// Provider cooldowns and the per-provider rate slot live in the shared store.
// Nothing is cooling and every slot is free, so every rung is actually tried.
vi.mock('../../api/_lib/provider-health.js', async (importActual) => ({
	...(await importActual()),
	providersInCooldown: async () => new Set(),
	markProviderCooldown: async () => {},
}));
vi.mock('../../api/_lib/forge-scale.js', async (importActual) => ({
	...(await importActual()),
	reserveProviderRateSlot: async () => ({ ok: true, waitMs: 0 }),
}));

// Image bytes are written to object storage.
const persisted = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../api/_lib/image-persist.js', async (importOriginal) => {
	const real = await importOriginal();
	const next = async () => {
		persisted.calls++;
		return `https://cdn.test/protected-${persisted.calls}.png`;
	};
	return { ...real, persistImageBytes: next, persistImageBase64: next };
});

// The Vertex image client wraps the Google Cloud SDK. Each call is recorded in
// the shared rung log so the ladder order can be read back, and fails like the
// 2026-11-26 billing hold so the next rung is reached.
const rungLog = vi.hoisted(() => []);
const vertexEdit = vi.hoisted(() => ({ serves: false }));
vi.mock('../../api/_mcp3d/vertex-imagen.js', () => ({
	isConfigured: () => Boolean(process.env.GOOGLE_CLOUD_PROJECT),
	generateImage: async () => {
		rungLog.push('vertex');
		throw Object.assign(new Error('vertex 403: billing account disabled'), { status: 403 });
	},
	editImage: async () => {
		rungLog.push('vertex-edit');
		if (vertexEdit.serves) return { imageUrl: 'data:image/png;base64,iVBORw0KGgo=', model: 'vertex-edit' };
		throw Object.assign(new Error('vertex 403: billing account disabled'), { status: 403 });
	},
}));

// The Livepeer federation client. Enabled in the ladder test so its slot in the
// order is pinned too; it fails so the next rung is reached.
vi.mock('../../api/_providers/livepeer.js', () => ({
	livepeerFederationEnabled: () => process.env.LIVEPEER_FEDERATION_ENABLED === '1',
	livepeerTextToImage: async () => {
		rungLog.push('livepeer');
		throw new Error('livepeer federation unavailable');
	},
}));

const tiers = await import('../../api/_lib/forge-tiers.js');
const {
	BACKENDS,
	FREE_FALLBACK_FOR_PATH,
	FREE_DEFAULT_FOR_TIERS,
	DEFAULT_BACKEND_FOR_PATH,
	SELFHOST_TRELLIS_QUALITY,
	TIER_IDS,
	freeLaneCandidates,
	resolveBackendId,
	resolveBackendIdWithHealth,
	backendIsConfigured,
	isSelfHostImageLane,
	isSelfHostBackend,
	nextSelfHostImageLane,
	selfhostQualityForTier,
	selfHostPrimary,
	estimateEtaSeconds,
	coldStartSecondsFor,
	backendAcceptsInlineViews,
} = tiers;
const { createRegenProvider: createGcpProvider } = await import('../../api/_providers/gcp.js');
const { GCP_TASK_MISSING_GRACE_MS, GCP_TASK_MISSING_CODE } = await import(
	'../../api/_lib/forge-selfhost-recovery.js'
);
const { textToImage } = await import('../../api/_mcp3d/text-to-image.js');
const { default: forgeHandler } = await import('../../api/forge.js');

// ── Shared fixtures ──────────────────────────────────────────────────────────

const RULE =
	'Protected Forge lane moved. trellis_selfhost and the keyless image rung are protected ' +
	'(docs/ops/forge-protected-lanes.md). Changing this needs the owner\'s explicit yes before ' +
	'it is committed; with that yes, edit the expected value in tests/api/forge-protected-lanes.test.js ' +
	'in the same commit.';

const WORKER = 'https://model-trellis.protected.test';
const WORKER_KEY = 'protected-worker-key';
const PHOTO = 'https://cdn.test/fixed-photo.png';

// Every env var these tests set or clear, saved and restored around each test.
const VARS = [
	'MODEL_TRELLIS_URL',
	'MODEL_TRELLIS2_URL',
	'GCP_RECONSTRUCTION_KEY',
	'GCP_HUNYUAN3D_URL',
	'MODEL_MODLY_URL',
	'MODEL_PIXAL3D_URL',
	'HF_TOKEN',
	'NVIDIA_API_KEY',
	'REPLICATE_API_TOKEN',
	'FORGE_SELFHOST_PRIMARY',
	'FORGE_PREFER_FREE',
	'GOOGLE_CLOUD_PROJECT',
	'VERTEX_IMAGEN_ENABLED',
	'VERTEX_IMAGEN_FIRST',
	'LIVEPEER_FEDERATION_ENABLED',
	'TEXT_TO_IMAGE_BUDGET_MS',
	'APP_ORIGIN',
	'JWT_SECRET',
];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	for (const v of VARS) {
		saved[v] = process.env[v];
		delete process.env[v];
	}
	rungLog.length = 0;
	persisted.calls = 0;
	vertexEdit.serves = false;
});
afterEach(() => {
	for (const v of VARS) {
		if (saved[v] === undefined) delete process.env[v];
		else process.env[v] = saved[v];
	}
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

// The routing env production ran on 2026-11-26 (read from the three-ws-api
// Cloud Run service): our TRELLIS worker, the Hunyuan3D worker, HuggingFace and
// NVIDIA configured, no TRELLIS.2 worker URL, FORGE_SELFHOST_PRIMARY=1.
function productionRoutingEnv({ selfHostPrimary = '1', trellis2 = false } = {}) {
	process.env.MODEL_TRELLIS_URL = WORKER;
	process.env.GCP_RECONSTRUCTION_KEY = WORKER_KEY;
	process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan3d.protected.test';
	process.env.HF_TOKEN = 'hf-protected';
	process.env.NVIDIA_API_KEY = 'nvidia-protected';
	if (selfHostPrimary != null) process.env.FORGE_SELFHOST_PRIMARY = selfHostPrimary;
	if (trellis2) process.env.MODEL_TRELLIS2_URL = 'https://model-trellis2.protected.test';
}

// The worker contract is the bearer key plus the JSON content type. A W3C
// `traceparent` header rides along when tracing is on; it carries no request
// content, so it is the one extra header allowed.
const WORKER_HEADERS = { authorization: `Bearer ${WORKER_KEY}`, 'content-type': 'application/json' };
function workerHeaders(headers) {
	const { traceparent, ...rest } = headers || {};
	if (traceparent !== undefined) expect(traceparent, RULE).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
	return rest;
}

const json = (status, body, headers = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// ── 1. The backend entry ─────────────────────────────────────────────────────

describe('protected lane trellis_selfhost: its backend entry does not change', () => {
	it('keeps every routing-relevant field of the trellis_selfhost entry exactly as it is', () => {
		// The blurb is display copy and is deliberately left out; every field that
		// decides routing, gating, cost or the ETA is pinned.
		const { blurb, ...entry } = BACKENDS.trellis_selfhost;
		expect(typeof blurb, RULE).toBe('string');
		expect(entry, RULE).toEqual({
			id: 'trellis_selfhost',
			label: 'TRELLIS (self-host)',
			vendor: 'Microsoft TRELLIS · self-host',
			paths: ['image'],
			byok: false,
			provider: 'gcp',
			requiresEnv: ['MODEL_TRELLIS_URL', 'GCP_RECONSTRUCTION_KEY'],
			polyControl: false,
			userImages: true,
			baseEta: 60,
			coldStartSeconds: 510,
			credits: null,
			free: true,
		});
	});

	it('keeps trellis_selfhost a self-host GCP lane that reads inline reference views', () => {
		expect(isSelfHostBackend('trellis_selfhost'), RULE).toBe(true);
		expect(isSelfHostImageLane('trellis_selfhost'), RULE).toBe(true);
		expect(backendAcceptsInlineViews('trellis_selfhost'), RULE).toBe(true);
	});
});

// ── 2. Its position in every list that decides who serves ────────────────────

describe('protected lane trellis_selfhost: its position in the chain does not change', () => {
	it('keeps the image fallback chain in exactly this order', () => {
		expect([...FREE_FALLBACK_FOR_PATH.image], RULE).toEqual([
			'trellis2',
			'trellis_selfhost',
			'hunyuan3d',
			'huggingface',
			'modly',
			'modly_hunyuan',
			'nvidia',
		]);
	});

	it('keeps trellis_selfhost directly behind trellis2 and directly ahead of hunyuan3d', () => {
		const chain = FREE_FALLBACK_FOR_PATH.image;
		const at = chain.indexOf('trellis_selfhost');
		expect(at, RULE).toBe(1);
		expect(chain[at - 1], RULE).toBe('trellis2');
		expect(chain[at + 1], RULE).toBe('hunyuan3d');
	});

	it('keeps the named free default per tier and the paid last-resort table unchanged', () => {
		expect(JSON.parse(JSON.stringify(FREE_DEFAULT_FOR_TIERS)), RULE).toEqual({
			draft: { image: 'trellis2' },
			standard: { image: 'trellis2' },
			high: { image: 'trellis2' },
		});
		expect({ ...DEFAULT_BACKEND_FOR_PATH }, RULE).toEqual({
			image: 'trellis',
			geometry: 'meshy',
			sketch: 'triposg',
		});
	});

	it('keeps trellis_selfhost the place a down TRELLIS.2 or Modly job retries', () => {
		productionRoutingEnv({ trellis2: true });
		process.env.MODEL_MODLY_URL = 'https://modly.protected.test';
		expect(nextSelfHostImageLane('trellis2'), RULE).toBe('trellis_selfhost');
		// A Modly lane retries TRELLIS.2 first, then trellis_selfhost.
		expect(nextSelfHostImageLane('modly'), RULE).toBe('trellis2');
		delete process.env.MODEL_TRELLIS2_URL;
		expect(nextSelfHostImageLane('modly'), RULE).toBe('trellis_selfhost');
		expect(nextSelfHostImageLane('modly_hunyuan'), RULE).toBe('trellis_selfhost');
		// trellis_selfhost itself is the last self-host rung: nothing behind it.
		expect(nextSelfHostImageLane('trellis_selfhost'), RULE).toBeNull();
	});
});

// ── 3. Routing outcomes on the production configuration ──────────────────────

describe('protected lane trellis_selfhost: it serves what it served on 2026-11-26', () => {
	it('serves every unnamed photo and text request at every tier on the production env', () => {
		productionRoutingEnv();
		for (const tier of TIER_IDS) {
			for (const userImages of [true, false]) {
				expect(
					resolveBackendId({ path: 'image', tier, userImages, country: 'US' }),
					`${RULE} (tier=${tier}, userImages=${userImages})`,
				).toBe('trellis_selfhost');
			}
		}
	});

	it('serves an EU request too, where the Tencent lanes are dropped', () => {
		productionRoutingEnv();
		for (const tier of TIER_IDS) {
			expect(resolveBackendId({ path: 'image', tier, userImages: true, country: 'DE' }), RULE).toBe(
				'trellis_selfhost',
			);
		}
	});

	it('keeps the production candidate order for photos and text, with FORGE_SELFHOST_PRIMARY on', () => {
		productionRoutingEnv();
		expect(selfHostPrimary(), RULE).toBe(true);
		expect(freeLaneCandidates('image', 'standard', true, null, 'US'), RULE).toEqual([
			'trellis_selfhost',
			'hunyuan3d',
			'huggingface',
		]);
		expect(freeLaneCandidates('image', 'standard', false, null, 'US'), RULE).toEqual([
			'trellis_selfhost',
			'hunyuan3d',
			'huggingface',
			'nvidia',
		]);
	});

	it('keeps the same order with FORGE_SELFHOST_PRIMARY unset (the flag must not demote it)', () => {
		productionRoutingEnv({ selfHostPrimary: null });
		expect(selfHostPrimary(), RULE).toBe(false);
		expect(freeLaneCandidates('image', 'standard', false, null, 'US'), RULE).toEqual([
			'trellis_selfhost',
			'hunyuan3d',
			'huggingface',
			'nvidia',
		]);
	});

	it('keeps trellis_selfhost first at the high tier for hard-surface and organic subjects alike', () => {
		productionRoutingEnv();
		for (const subject of ['hardsurface', 'organic', null]) {
			expect(freeLaneCandidates('image', 'high', true, subject, 'US')[0], `${RULE} (subject=${subject})`).toBe(
				'trellis_selfhost',
			);
		}
	});

	it('keeps trellis_selfhost second, right behind a configured trellis2, never further back', () => {
		productionRoutingEnv({ trellis2: true });
		expect(freeLaneCandidates('image', 'standard', true, null, 'US').slice(0, 3), RULE).toEqual([
			'trellis2',
			'trellis_selfhost',
			'hunyuan3d',
		]);
	});

	it('keeps health-aware routing on trellis_selfhost while its probe reads ok or unknown', () => {
		productionRoutingEnv();
		for (const status of ['ok', 'unknown', undefined]) {
			const health = { trellis_selfhost: status, hunyuan3d: 'ok', huggingface: 'ok', nvidia: 'ok' };
			expect(
				resolveBackendIdWithHealth({ path: 'image', tier: 'standard', userImages: true, health, country: 'US' }),
				`${RULE} (trellis_selfhost health=${status})`,
			).toBe('trellis_selfhost');
		}
	});

	it('leaves trellis_selfhost only when its probe reads down, and falls to hunyuan3d behind it', () => {
		productionRoutingEnv();
		const health = { trellis_selfhost: 'down', hunyuan3d: 'ok', huggingface: 'ok', nvidia: 'ok' };
		expect(
			resolveBackendIdWithHealth({ path: 'image', tier: 'standard', userImages: true, health, country: 'US' }),
			RULE,
		).toBe('hunyuan3d');
	});
});

// ── 4. Env gating ────────────────────────────────────────────────────────────

describe('protected lane trellis_selfhost: the env vars that switch it on do not change', () => {
	it('is configured only when MODEL_TRELLIS_URL and GCP_RECONSTRUCTION_KEY are both set', () => {
		expect(backendIsConfigured('trellis_selfhost'), RULE).toBe(false);
		process.env.MODEL_TRELLIS_URL = WORKER;
		expect(backendIsConfigured('trellis_selfhost'), RULE).toBe(false);
		process.env.GCP_RECONSTRUCTION_KEY = WORKER_KEY;
		expect(backendIsConfigured('trellis_selfhost'), RULE).toBe(true);
		delete process.env.MODEL_TRELLIS_URL;
		expect(backendIsConfigured('trellis_selfhost'), RULE).toBe(false);
	});

	it('reads FORGE_SELFHOST_PRIMARY as on only for an explicit truthy value', () => {
		for (const on of ['1', 'true', 'on', 'yes', 'TRUE']) {
			process.env.FORGE_SELFHOST_PRIMARY = on;
			expect(selfHostPrimary(), `${RULE} (FORGE_SELFHOST_PRIMARY=${on})`).toBe(true);
		}
		for (const off of ['0', 'false', 'off', 'no', '']) {
			process.env.FORGE_SELFHOST_PRIMARY = off;
			expect(selfHostPrimary(), `${RULE} (FORGE_SELFHOST_PRIMARY=${off})`).toBe(false);
		}
	});
});

// ── 5. Quality budgets ───────────────────────────────────────────────────────

describe('protected lane trellis_selfhost: its quality budgets are not re-tuned', () => {
	it('keeps the per-tier sampler, decimation and texture budgets exactly as they are', () => {
		expect(JSON.parse(JSON.stringify(SELFHOST_TRELLIS_QUALITY)), RULE).toEqual({
			draft: { ss_steps: 12, slat_steps: 12, simplify: 0.95, texture_size: 1024 },
			standard: { ss_steps: 35, slat_steps: 35, simplify: 0.82, texture_size: 2048 },
			high: { ss_steps: 50, slat_steps: 50, simplify: 0.65, texture_size: 4096 },
		});
	});

	it('keeps every texture_size a power of two (the bake fails on anything else)', () => {
		for (const [tier, q] of Object.entries(SELFHOST_TRELLIS_QUALITY)) {
			const n = q.texture_size;
			expect(Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0, `${RULE} (tier=${tier}, texture_size=${n})`).toBe(
				true,
			);
		}
	});

	it('maps each tier to its own budget and an unknown tier to standard', () => {
		for (const tier of TIER_IDS) {
			expect(selfhostQualityForTier(tier), RULE).toBe(SELFHOST_TRELLIS_QUALITY[tier]);
		}
		expect(selfhostQualityForTier('max'), RULE).toBe(SELFHOST_TRELLIS_QUALITY.standard);
		expect(selfhostQualityForTier(undefined), RULE).toBe(SELFHOST_TRELLIS_QUALITY.standard);
	});
});

// ── 6. Cold start and ETA ────────────────────────────────────────────────────

describe('protected lane trellis_selfhost: its cold-start allowance does not change', () => {
	it('keeps the 510 s cold-start budget and the ETA it produces at every tier', () => {
		expect(coldStartSecondsFor('trellis_selfhost'), RULE).toBe(510);
		const warm = Object.fromEntries(TIER_IDS.map((t) => [t, estimateEtaSeconds({ backendId: 'trellis_selfhost', tier: t })]));
		const cold = Object.fromEntries(
			TIER_IDS.map((t) => [t, estimateEtaSeconds({ backendId: 'trellis_selfhost', tier: t, cold: true })]),
		);
		expect(warm, RULE).toEqual({ draft: 36, standard: 60, high: 132 });
		expect(cold, RULE).toEqual({ draft: 546, standard: 570, high: 642 });
	});
});

// ── 7. The request the worker receives ───────────────────────────────────────

// Captures every outbound fetch. The worker answers like workers/model-trellis
// (202 + task_id on /infer); any other host is refused, the way an unreachable
// network would refuse it, so nothing leaves the test.
function captureFetch() {
	const calls = [];
	globalThis.fetch = vi.fn(async (url, init = {}) => {
		const u = String(url);
		const call = {
			url: u,
			method: init.method || 'GET',
			headers: { ...(init.headers || {}) },
			body: typeof init.body === 'string' ? init.body : null,
		};
		calls.push(call);
		if (u === `${WORKER}/infer`) return json(202, { task_id: 'protected-task-1', status: 'queued' });
		if (u.startsWith(WORKER)) return json(200, { status: 'ok' });
		throw new TypeError(`fetch refused in protected-lanes test: ${u}`);
	});
	return calls;
}

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: {
			'content-type': 'application/json',
			'x-forge-client': 'protected-lanes',
			'x-vercel-ip-country': 'US',
		},
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
}

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

describe('protected lane trellis_selfhost: the request POST /api/forge sends its worker does not change', () => {
	beforeEach(() => {
		productionRoutingEnv();
		process.env.APP_ORIGIN = 'https://three.ws';
		process.env.JWT_SECRET = 'protected-lanes-jwt-secret-at-least-32-chars';
	});

	it('sends exactly this /infer request for one photo with default options', async () => {
		const calls = captureFetch();
		const res = makeRes();
		await forgeHandler(makeReq({ image_urls: [PHOTO] }), res);

		const infer = calls.filter((c) => c.url === `${WORKER}/infer`);
		expect(infer, `${RULE} (handler answered ${res.statusCode} ${JSON.stringify(res.body)})`).toHaveLength(1);
		const [req] = infer;
		expect(req.method, RULE).toBe('POST');
		expect(workerHeaders(req.headers), RULE).toEqual(WORKER_HEADERS);
		// Default tier is standard: the standard budget, background pre-matting
		// on, no seed (the worker picks one), the photo as the only view (no
		// turnaround views exist without the Vertex edit lane).
		expect(JSON.parse(req.body), RULE).toEqual({
			images: [PHOTO],
			body_type: 'neutral',
			quality: { ss_steps: 35, slat_steps: 35, simplify: 0.82, texture_size: 2048 },
			matte: true,
		});
		expect(res.body?.backend, RULE).toBe('trellis_selfhost');
	});

	it('sends the draft budget, a seed, and no matte for a draft photo with a seed', async () => {
		const calls = captureFetch();
		await forgeHandler(makeReq({ image_urls: [PHOTO], tier: 'draft', seed: 4242 }), makeRes());
		const infer = calls.filter((c) => c.url === `${WORKER}/infer`);
		expect(infer, RULE).toHaveLength(1);
		expect(JSON.parse(infer[0].body), RULE).toEqual({
			images: [PHOTO],
			body_type: 'neutral',
			quality: { ss_steps: 12, slat_steps: 12, simplify: 0.95, texture_size: 1024 },
			seed: 4242,
		});
	});

	it('appends the two turnaround views after the photo when the Vertex edit lane serves them', async () => {
		process.env.GOOGLE_CLOUD_PROJECT = 'protected-project';
		vertexEdit.serves = true;
		const calls = captureFetch();
		await forgeHandler(makeReq({ image_urls: [PHOTO] }), makeRes());
		const infer = calls.filter((c) => c.url === `${WORKER}/infer`);
		expect(infer, RULE).toHaveLength(1);
		expect(JSON.parse(infer[0].body), RULE).toEqual({
			images: [PHOTO, 'https://cdn.test/protected-1.png', 'https://cdn.test/protected-2.png'],
			body_type: 'neutral',
			quality: { ss_steps: 35, slat_steps: 35, simplify: 0.82, texture_size: 2048 },
			matte: true,
		});
	});

	// The High tier is $THREE hold-or-pay gated before any lane runs (the
	// handler answers 402 three_hold_required for an account that holds none),
	// so its request is pinned one seam down: the params api/forge.js builds for
	// a high-tier trellis_selfhost job, through the gcp provider, to the wire.
	it('turns the high-tier params api/forge.js builds into exactly this /infer request', async () => {
		const calls = captureFetch();
		await createGcpProvider().submit({
			mode: 'trellis',
			sourceUrl: PHOTO,
			params: { images: [PHOTO], seed: undefined, quality: selfhostQualityForTier('high'), matte: true },
		});
		expect(calls.map((c) => c.url), RULE).toEqual([`${WORKER}/infer`]);
		expect(calls[0].method, RULE).toBe('POST');
		expect(workerHeaders(calls[0].headers), RULE).toEqual(WORKER_HEADERS);
		expect(JSON.parse(calls[0].body), RULE).toEqual({
			images: [PHOTO],
			body_type: 'neutral',
			quality: { ss_steps: 50, slat_steps: 50, simplify: 0.65, texture_size: 4096 },
			matte: true,
		});
	});
});

// ── 8. How its job is packed, polled and finalized ───────────────────────────

describe('protected lane trellis_selfhost: how its job is polled and finalized does not change', () => {
	beforeEach(() => {
		process.env.MODEL_TRELLIS_URL = WORKER;
		process.env.GCP_RECONSTRUCTION_KEY = WORKER_KEY;
	});

	async function submitOne() {
		globalThis.fetch = vi.fn(async () => json(202, { task_id: 'task/with space', status: 'queued' }));
		const gcp = createGcpProvider();
		return { gcp, job: await gcp.submit({ mode: 'trellis', sourceUrl: PHOTO, params: { images: [PHOTO] } }) };
	}

	it('packs the poll token as base64url JSON of mode, task id, worker URL and result key', async () => {
		const { job } = await submitOne();
		expect(JSON.parse(Buffer.from(job.extJobId, 'base64url').toString('utf8')), RULE).toEqual({
			mode: 'trellis',
			taskId: 'task/with space',
			baseUrl: WORKER,
			resultKey: 'result_gcs_url',
		});
		expect({ eta: job.eta, backend: job.backend, viewsUsed: job.viewsUsed, multiview: job.multiview }, RULE).toEqual({
			eta: 60,
			backend: 'gcp',
			viewsUsed: 1,
			multiview: false,
		});
	});

	it('polls GET /tasks/:id (id URL-encoded) with the same bearer header', async () => {
		const { gcp, job } = await submitOne();
		const polls = [];
		globalThis.fetch = vi.fn(async (url, init = {}) => {
			polls.push({ url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) } });
			return json(200, { status: 'running' });
		});
		const out = await gcp.status(job.extJobId);
		expect(out.status, RULE).toBe('running');
		expect(polls.map(({ url, method }) => ({ url, method })), RULE).toEqual([
			{ url: `${WORKER}/tasks/task%2Fwith%20space`, method: 'GET' },
		]);
		expect(workerHeaders(polls[0].headers), RULE).toEqual(WORKER_HEADERS);
	});

	it('translates each worker status the same way and reads the GLB from result_gcs_url', async () => {
		const { gcp, job } = await submitOne();
		const cases = [
			[{ status: 'queued' }, { status: 'queued' }],
			[{ status: 'running' }, { status: 'running' }],
			[{ status: 'mystery' }, { status: 'queued' }],
			[
				{ status: 'done', result_gcs_url: 'https://storage.googleapis.com/b/raw-meshes/trellis/t.glb' },
				{ status: 'done', resultGlbUrl: 'https://storage.googleapis.com/b/raw-meshes/trellis/t.glb' },
			],
			[{ status: 'done' }, { status: 'failed', error: 'trellis finished but no result URL in response' }],
		];
		for (const [worker, expected] of cases) {
			globalThis.fetch = vi.fn(async () => json(200, worker));
			const out = await gcp.status(job.extJobId);
			expect(out, `${RULE} (worker said ${JSON.stringify(worker)})`).toMatchObject(expected);
		}
		globalThis.fetch = vi.fn(async () => json(200, { status: 'failed', error: 'CUDA out of memory' }));
		expect((await gcp.status(job.extJobId)).status, RULE).toBe('failed');
	});

	it('treats a 404 as the recoverable missing-task class and a 5xx as still running', async () => {
		const { gcp, job } = await submitOne();
		globalThis.fetch = vi.fn(async () => json(404, { detail: 'not found' }));
		expect(await gcp.status(job.extJobId), RULE).toEqual({
			status: 'failed',
			error: 'task not found on gcp service',
			code: GCP_TASK_MISSING_CODE,
		});
		expect(GCP_TASK_MISSING_CODE, RULE).toBe('gcp_task_missing');
		expect(GCP_TASK_MISSING_GRACE_MS, RULE).toBe(90_000);
		globalThis.fetch = vi.fn(async () => json(503, { detail: 'busy' }));
		expect((await gcp.status(job.extJobId)).status, RULE).toBe('running');
	});

	it('refuses to poll a worker URL that is not the configured MODEL_TRELLIS_URL', async () => {
		const forged = Buffer.from(
			JSON.stringify({ mode: 'trellis', taskId: 't', baseUrl: 'https://evil.test', resultKey: 'result_gcs_url' }),
		).toString('base64url');
		globalThis.fetch = vi.fn(async () => {
			throw new Error('must not be called');
		});
		const gcp = createGcpProvider();
		expect(await gcp.status(forged), RULE).toEqual({ status: 'failed', error: 'malformed ext_job_id' });
		expect(globalThis.fetch, RULE).not.toHaveBeenCalled();
	});
});

// ── 9. The keyless text-to-image rung keeps its position ─────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// Names each outbound image request by rung and fails every keyed rung, the way
// production failed them on 2026-11-26. `pollinations` decides the keyless rung.
function ladderFetch({ pollinations }) {
	globalThis.fetch = vi.fn(async (url) => {
		const u = String(url);
		if (u.includes('ai.api.nvidia.com')) {
			rungLog.push('nim');
			return json(504, { error: 'gateway timeout' });
		}
		if (u.includes('router.huggingface.co/fal-ai')) {
			rungLog.push('hf-fal');
			return json(402, { error: 'credits exhausted' });
		}
		if (u.includes('router.huggingface.co/wavespeed')) {
			rungLog.push('hf-wavespeed');
			return json(402, { error: 'credits exhausted' });
		}
		if (u.includes('image.pollinations.ai')) {
			rungLog.push('pollinations');
			return pollinations();
		}
		if (u.includes('api.replicate.com')) {
			rungLog.push('replicate');
			return json(402, { detail: 'insufficient credit' });
		}
		// Unknown host: a rung nobody listed here. Recorded under its host so the
		// order assertion names it, then refused.
		rungLog.push(`unlisted:${new URL(u).host}`);
		throw new TypeError(`unlisted image rung: ${u}`);
	});
}

// The order rungs were tried in. A rung's own transport retry (fetchUpstream
// retries a 5xx once) is the same rung, so consecutive repeats collapse.
function rungOrder() {
	return rungLog.filter((r, i) => r !== rungLog[i - 1]);
}

function enableEveryImageRung() {
	process.env.GOOGLE_CLOUD_PROJECT = 'protected-project';
	process.env.NVIDIA_API_KEY = 'nvidia-protected';
	process.env.HF_TOKEN = 'hf-protected';
	process.env.LIVEPEER_FEDERATION_ENABLED = '1';
	process.env.REPLICATE_API_TOKEN = 'replicate-protected';
}

describe('protected rung: keyless Pollinations keeps its place in the text-to-image ladder', () => {
	it('is reached in exactly this order with every rung configured, and nothing new sits ahead of it', async () => {
		enableEveryImageRung();
		ladderFetch({ pollinations: () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }) });
		const out = await textToImage('a brass compass', { budgetMs: 60_000 });
		expect(out.model, RULE).toBe('pollinations/flux');
		expect(rungOrder(), RULE).toEqual(['vertex', 'nim', 'hf-fal', 'hf-wavespeed', 'livepeer', 'pollinations']);
	});

	it('stays ahead of the paid Replicate rung, which is reached only after it fails', async () => {
		enableEveryImageRung();
		ladderFetch({ pollinations: () => json(402, { error: { code: 'FREE_LIMIT', message: 'Retry after 45s' } }) });
		await textToImage('a brass compass', { budgetMs: 60_000 }).catch(() => {});
		const order = rungOrder();
		const at = order.indexOf('pollinations');
		expect(at, RULE).toBeGreaterThan(-1);
		expect(order.slice(0, at), RULE).toEqual(['vertex', 'nim', 'hf-fal', 'hf-wavespeed', 'livepeer']);
		expect(order[at + 1], RULE).toBe('replicate');
	});

	it('serves with no key configured at all, so a fallback always exists', async () => {
		ladderFetch({ pollinations: () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }) });
		const out = await textToImage('a brass compass', { budgetMs: 60_000 });
		expect(out.model, RULE).toBe('pollinations/flux');
		expect(rungOrder(), RULE).toEqual(['pollinations']);
	});
});

// ── 10. The re-measure script (npm run forge:lanes) ──────────────────────────

describe('npm run forge:lanes: classifies live stats by the protected-lane rule and checks the doc', async () => {
	const { classifyLanes, parseDocProtected, compareWithDoc } = await import('../../scripts/forge-protected-lanes.mjs');
	const { readFile } = await import('node:fs/promises');
	const lane = (id, done, failed, success_pct) => ({ id, jobs: { '7d': { done, failed, success_pct } } });

	it('protects 20+ finished jobs at 85%+ success, and trellis_selfhost by name', () => {
		const rows = classifyLanes({
			lanes: [
				lane('trellis_selfhost', 1, 9, 10),
				lane('steady', 18, 2, 90),
				lane('too_few', 19, 0, 100),
				lane('flaky', 30, 10, 75),
				{ id: 'nim_embeddings', jobs: null },
			],
		});
		expect(rows.map((r) => [r.id, r.protected, r.reason])).toEqual([
			['trellis_selfhost', true, 'by name'],
			['steady', true, 'measured'],
			['too_few', false, null],
			['flaky', false, null],
		]);
	});

	it('reads the dated protected list from docs/ops/forge-protected-lanes.md', async () => {
		const doc = parseDocProtected(await readFile('docs/ops/forge-protected-lanes.md', 'utf8'));
		expect(doc, 'the doc must keep a "## Measured state, <date>" section with a "Protected:" list').not.toBeNull();
		expect(doc.ids).toContain('trellis_selfhost');
		expect(doc.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
	});

	it('flags a lane the measurement protects that the doc omits, and one the doc keeps that lost protection', () => {
		const rows = classifyLanes({ lanes: [lane('trellis_selfhost', 900, 50, 94.7), lane('steady', 40, 2, 95.2), lane('triposg', 20, 30, 40)] });
		const out = compareWithDoc(rows, { measuredAt: '2026-11-26', ids: ['trellis_selfhost', 'triposg'] });
		expect(out.agrees).toBe(false);
		expect(out.missingFromDoc).toEqual(['steady']);
		expect(out.staleInDoc).toEqual(['triposg']);
		expect(compareWithDoc(rows, { measuredAt: '2026-11-26', ids: ['trellis_selfhost', 'steady'] }).agrees).toBe(true);
	});
});
