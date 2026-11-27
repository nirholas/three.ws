/**
 * The image-lane health payload (api/_lib/ai-image-lanes.js) carries the Vertex
 * image breaker (api/_lib/vertex-image-breaker.js): whether the lane is parked,
 * the class of the failure that parked it, and when the next probe goes out.
 *
 * Measured 2026-11-26: Vertex answered every image call 403 "There are issues
 * with your billing account". An operator reading health must see that the lane
 * is parked on billing and when it will be retried, without tailing logs. The
 * breaker and the cache are real (in-memory backend); only the network and the
 * token mint are stood in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: async () => 'token',
	gcpAuthConfigured: () => true,
}));
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));

const ENV = ['GOOGLE_CLOUD_PROJECT', 'NVIDIA_API_KEY', 'REPLICATE_API_TOKEN', 'HF_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
const ORIGINAL_ENV = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const ORIGINAL_FETCH = globalThis.fetch;

const { imageLaneHealth } = await import('../api/_lib/ai-image-lanes.js');
const { recordVertexFailure, recordVertexSuccess, vertexBreakerGate, resetVertexBreaker } = await import(
	'../api/_lib/vertex-image-breaker.js'
);

const BILLING_HOLD = Object.assign(
	new Error('There are issues with your billing account, please resolve / pay your outstanding balance for project: projects/93741856'),
	{ providerStatus: 403 },
);

beforeEach(async () => {
	for (const k of ENV) delete process.env[k];
	process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
	globalThis.fetch = vi.fn(async (url) => {
		const u = String(url);
		if (u.includes('aiplatform.googleapis.com')) return new Response('{}', { status: 200 });
		if (u.includes('pollinations')) return new Response(null, { status: 200 });
		throw new Error(`unexpected fetch ${u}`);
	});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	await resetVertexBreaker();
});

afterEach(async () => {
	vi.useRealTimers();
	globalThis.fetch = ORIGINAL_FETCH;
	for (const k of ENV) {
		if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
		else process.env[k] = ORIGINAL_ENV[k];
	}
	vi.restoreAllMocks();
	await resetVertexBreaker();
});

describe('health shows the Vertex image breaker', () => {
	it('reads closed when nothing has failed', async () => {
		const h = await imageLaneHealth();
		expect(h.lanes.vertex.breaker).toEqual({ state: 'closed' });
	});

	it('after a billing hold: open, class billing, the Google detail, and the next probe time', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
		await recordVertexFailure(await vertexBreakerGate(), BILLING_HOLD);
		const { breaker } = (await imageLaneHealth()).lanes.vertex;
		expect(breaker).toMatchObject({
			state: 'open',
			kind: 'billing',
			status: 403,
			failures: 1,
			next_probe_at: '2026-11-26T12:10:00.000Z',
		});
		expect(breaker.detail).toMatch(/billing account/);
	});

	it('reads half_open once the window passes, then closed after a successful probe', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
		await recordVertexFailure(await vertexBreakerGate(), BILLING_HOLD);
		vi.setSystemTime(new Date('2026-11-26T12:10:01Z'));
		expect((await imageLaneHealth()).lanes.vertex.breaker.state).toBe('half_open');
		await recordVertexSuccess(await vertexBreakerGate());
		expect((await imageLaneHealth()).lanes.vertex.breaker).toEqual({ state: 'closed' });
	});

	it('reading health never calls Vertex image generation', async () => {
		await imageLaneHealth();
		const imageCalls = globalThis.fetch.mock.calls.filter(([u]) => /:(generateContent|predict)\b/.test(String(u)));
		expect(imageCalls).toHaveLength(0);
	});
});
