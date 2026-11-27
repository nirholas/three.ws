/**
 * The NIM FLUX health check (api/_lib/ai-image-lanes.js) must say whether the
 * pinned model is served, not whether NVIDIA's host answers at all.
 *
 * Until 2026-11-27 it sent a GET to https://ai.api.nvidia.com/v1/models, a
 * path that does not exist there and always answers 404, and read any status
 * under 500 as ok. Health stayed green through the weeks the rung timed out on
 * every request, and it would stay green if the pinned id were retired.
 *
 * The genai gateway answers a GET on a served model route with 405 and on a
 * retired or unknown id with 404, without invoking the model, so a GET on the
 * pinned route is a free and honest check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NVIDIA_API_KEY = 'nvapi-test';
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.REPLICATE_API_TOKEN;
delete process.env.HF_TOKEN;

const cooling = new Set();
vi.mock('../api/_lib/provider-health.js', () => ({
	providersInCooldown: async (keys) => new Set(keys.filter((k) => cooling.has(k))),
	markProviderCooldown: async () => {},
	clearProviderCooldown: async () => {},
	providerCooldownUntil: async () => null,
}));

const nvidia = { respond: null };
globalThis.fetch = vi.fn(async (url) => {
	const u = String(url);
	if (u.includes('nvidia.com')) return nvidia.respond(u);
	if (u.includes('pollinations')) return new Response(null, { status: 200 });
	throw new Error(`unexpected fetch ${u}`);
});

const { imageLaneHealth } = await import('../api/_lib/ai-image-lanes.js');
const { NIM_FLUX_URL, NIM_FLUX_MODEL } = await import('../api/_lib/nim-flux.js');

// What NVIDIA's gateway does: 405 on a served model route, 404 on anything else.
const realGateway = (u) => new Response(null, { status: u === NIM_FLUX_URL ? 405 : 404 });

beforeEach(() => {
	cooling.clear();
	nvidia.respond = realGateway;
	globalThis.fetch.mockClear();
});

const nimCalls = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('nvidia.com'));

describe('NIM FLUX health probe', () => {
	it('checks the pinned model route, and reads its 405 as served', async () => {
		const h = await imageLaneHealth();
		expect(h.lanes.nim.status).toBe('ok');
		expect(h.lanes.nim.model).toBe(NIM_FLUX_MODEL);
		expect(nimCalls()).toHaveLength(1);
		expect(String(nimCalls()[0][0])).toBe(NIM_FLUX_URL);
		// A GET never invokes the model, so the check costs no credits.
		expect(nimCalls()[0][1]?.method ?? 'GET').toBe('GET');
	});

	it('is down when NVIDIA no longer serves the pinned model (404)', async () => {
		nvidia.respond = () => new Response(null, { status: 404 });
		const h = await imageLaneHealth();
		expect(h.lanes.nim.status).toBe('down');
		expect(h.lanes.nim.httpStatus).toBe(404);
		expect(h.lanes.nim.detail).toMatch(/no longer serves/i);
	});

	it('is down, naming the key, when NVIDIA rejects it', async () => {
		nvidia.respond = () => new Response(null, { status: 401 });
		const h = await imageLaneHealth();
		expect(h.lanes.nim.status).toBe('down');
		expect(h.lanes.nim.detail).toMatch(/key/i);
	});

	it('is degraded while NVIDIA is throttling the key', async () => {
		nvidia.respond = () => new Response(null, { status: 429 });
		const h = await imageLaneHealth();
		expect(h.lanes.nim.status).toBe('degraded');
	});

	it('is down on a gateway 5xx', async () => {
		nvidia.respond = () => new Response(null, { status: 503 });
		const h = await imageLaneHealth();
		expect(h.lanes.nim.status).toBe('down');
		expect(h.lanes.nim.httpStatus).toBe(503);
	});

	it('is degraded without calling NVIDIA while the rung breaker is cooling it', async () => {
		cooling.add('forge-nim-flux');
		const h = await imageLaneHealth();
		expect(h.lanes.nim.status).toBe('degraded');
		expect(nimCalls()).toHaveLength(0);
	});
});
