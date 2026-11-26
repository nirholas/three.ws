/**
 * A TRELLIS.2 lane that is not configured costs a photo request nothing.
 *
 * FREE_FALLBACK_FOR_PATH.image names `trellis2` first, but production has never
 * set MODEL_TRELLIS2_URL (Forge hardening 16, 2026-11-26: 0 trellis2 jobs in 7
 * days against 914 served by trellis_selfhost). The lane is skipped by
 * backendIsConfigured before any network work, so a photo goes straight to the
 * self-hosted TRELLIS worker. These tests pin that: driving a real POST through
 * both forge handlers with the real gcp provider, every outbound request is
 * recorded, and none of them names a TRELLIS.2 host, none waits on a timer, and
 * the only worker call is the TRELLIS /infer submit. The health probe, the
 * keep-warm cron and the failover lists skip the lane the same way.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const TRELLIS_URL = 'https://trellis.example.run.app';
const PHOTO = 'https://cdn.example/photo.png';

// The production env shape on 2026-11-26: the TRELLIS worker wired, the self-host
// fleet hoisted, TRELLIS.2 absent. Every other worker URL is cleared so the only
// configured image lane besides the hosted ones is the one under test.
const ENV = {
	APP_ORIGIN: 'https://three.ws',
	MODEL_TRELLIS_URL: TRELLIS_URL,
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
	FORGE_SELFHOST_PRIMARY: '1',
	NVIDIA_API_KEY: 'nvapi-test',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
};
const CLEARED = ['MODEL_TRELLIS2_URL', 'GCP_HUNYUAN3D_URL', 'GCP_TRIPOSG_URL', 'MODEL_MODLY_URL', 'MODEL_PIXAL3D_URL', 'HF_TOKEN', 'FORGE_KEEPWARM_LANES'];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;

beforeAll(() => {
	for (const k of [...Object.keys(ENV), ...CLEARED]) saved[k] = process.env[k];
	Object.assign(process.env, ENV);
	for (const k of CLEARED) delete process.env[k];
});

afterAll(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

const { default: forgeHandler } = await import('../../api/forge.js');
const { default: gptForgeHandler } = await import('../../api/gpt-forge.js');
const { resolveBackendId, backendIsConfigured, FREE_FALLBACK_FOR_PATH } = await import('../../api/_lib/forge-tiers.js');
const { probeForgeLane } = await import('../../api/_lib/forge-health.js');
const { resolveKeepwarmLanes } = await import('../../api/cron/gpu-keepwarm.js');
const { pickRedispatchLane, retryBackendSuggestions } = await import('../../api/_lib/forge-failover.js');

// Every outbound request, in order. The TRELLIS worker accepts the submit; any
// other host gets a 404 so an unexpected call is visible rather than hanging.
let requests = [];
function recordingFetch() {
	requests = [];
	globalThis.fetch = vi.fn(async (input, opts = {}) => {
		const url = String(input?.url || input);
		requests.push({ url, method: opts.method || 'GET' });
		if (url === `${TRELLIS_URL}/infer`) {
			return new Response(JSON.stringify({ task_id: 'task-selfhost-1', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		}
		return new Response('not found', { status: 404 });
	});
}

const mentionsTrellis2 = (url) => /trellis2|trellis-2|TRELLIS2/i.test(url);

function makeReq(url, body) {
	return {
		method: 'POST',
		url,
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'cf-ipcountry': 'US' },
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
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

beforeEach(() => recordingFetch());

describe('routing with TRELLIS.2 unconfigured', () => {
	it('the configured first choice is still trellis2, and it is not configured', () => {
		// The premise of every test below: the list names trellis2 first, and the
		// env gate is what keeps it out.
		expect(FREE_FALLBACK_FOR_PATH.image[0]).toBe('trellis2');
		expect(backendIsConfigured('trellis2')).toBe(false);
		expect(backendIsConfigured('trellis_selfhost')).toBe(true);
	});

	it.each(['draft', 'standard', 'high', 'max'])('a %s photo resolves to trellis_selfhost', (tier) => {
		expect(resolveBackendId({ path: 'image', tier, userImages: true, country: 'US' })).toBe('trellis_selfhost');
	});
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('%s: a photo request never touches TRELLIS.2', (url, handler) => {
	// draft and standard are the free photo tiers; high and max stop at the
	// payment gate before routing, and their routing is pinned above.
	it.each(['draft', 'standard'])('%s tier: one worker call, to TRELLIS /infer, with no wait', async (tier) => {
		const res = makeRes();
		const started = performance.now();
		await handler(makeReq(url, { image_urls: [PHOTO], tier, path: 'image', skip_validation: true }), res);
		const elapsed = performance.now() - started;

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('trellis_selfhost');
		expect(requests.filter((r) => mentionsTrellis2(r.url))).toEqual([]);
		const workerCalls = requests.filter((r) => r.url.startsWith(TRELLIS_URL));
		expect(workerCalls).toEqual([{ url: `${TRELLIS_URL}/infer`, method: 'POST' }]);
		// Every network edge answers at once, so any backoff, cooldown or
		// cold-start wait spent on a skipped lane would show up here. Request
		// deadlines (timers that are cleared when the call answers) cost nothing.
		expect(elapsed).toBeLessThan(1_000);
	});
});

describe('the other trellis2 callers skip it with no network call', () => {
	it('the health probe reports unconfigured without fetching', async () => {
		const verdict = await probeForgeLane('trellis2');
		expect(verdict.status).toBe('unconfigured');
		expect(requests).toEqual([]);
	});

	it('the keep-warm cron does not warm it by default', () => {
		expect(resolveKeepwarmLanes('').lanes.map((l) => l.id)).not.toContain('trellis2');
	});

	it('failover never redispatches to it or suggests it', async () => {
		const next = await pickRedispatchLane({ attempted: [], country: 'US' });
		expect(next).not.toBe('trellis2');
		expect(retryBackendSuggestions({ attempted: ['trellis_selfhost'], hasImage: true, country: 'US' })).not.toContain('trellis2');
		expect(requests.filter((r) => mentionsTrellis2(r.url))).toEqual([]);
	});
});
