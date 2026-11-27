/**
 * The hourly production probe of the Forge NVIDIA FLUX rung
 * (api/_lib/nvidia-lanes.js, lane `nim_flux`).
 *
 * The rung timed out on every request for weeks in 2026-11 (flux.1-dev on
 * NVIDIA's gateway accepted the request and never answered) and nothing
 * measured it: the NVIDIA lane probes covered chat, vision, embeddings, safety,
 * speech, Audio2Face and TRELLIS, but not the image rung. This lane sends the
 * rung's exact request, against the model it is pinned to, under the rung's own
 * cap, and only an image NVIDIA says it finished counts as ok.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.NVIDIA_API_KEY = 'nvapi-test';

const nvidia = { respond: null, calls: [] };
globalThis.fetch = vi.fn(async (url, init = {}) => {
	nvidia.calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
	return nvidia.respond(init);
});

const { NVIDIA_LANES, laneById } = await import('../api/_lib/nvidia-lanes.js');
const { NIM_FLUX_URL, NIM_FLUX_MODEL, NIM_FLUX_STEPS, NIM_FLUX_CFG_SCALE, NIM_FLUX_TIMEOUT_MS } = await import('../api/_lib/nim-flux.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const finished = (finishReason = 'SUCCESS') =>
	json(200, { artifacts: [{ base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64'), finishReason }] });

beforeEach(() => {
	process.env.NVIDIA_API_KEY = 'nvapi-test';
	nvidia.calls = [];
	nvidia.respond = () => finished();
});

const probe = () => laneById('nim_flux').probe();

describe('nim_flux lane probe', () => {
	it('is registered as an hourly hosted lane naming the pinned model', () => {
		const lane = laneById('nim_flux');
		expect(lane).toMatchObject({ kind: 'hosted', everyMinutes: 60 });
		expect(lane.model()).toBe(NIM_FLUX_MODEL);
		expect(NVIDIA_LANES.filter((l) => l.id === 'nim_flux')).toHaveLength(1);
	});

	it('sends the rung\'s exact request to the pinned route and reads a finished image as ok', async () => {
		const r = await probe();
		expect(r).toMatchObject({ status: 'ok', http_status: 200, model: NIM_FLUX_MODEL });
		expect(r.latency_ms).toBeGreaterThanOrEqual(0);
		expect(nvidia.calls).toHaveLength(1);
		const [call] = nvidia.calls;
		expect(call.url).toBe(NIM_FLUX_URL);
		expect(call.init.method).toBe('POST');
		expect(call.init.headers.authorization).toBe('Bearer nvapi-test');
		expect(call.body).toMatchObject({ steps: NIM_FLUX_STEPS, cfg_scale: NIM_FLUX_CFG_SCALE, width: 512, height: 512 });
		expect(Object.keys(call.body).sort()).toEqual(['cfg_scale', 'height', 'prompt', 'steps', 'width']);
		// Never the short NVCF poll header: it turns a slow answer into a 504.
		expect(Object.keys(call.init.headers).map((h) => h.toLowerCase())).not.toContain('nvcf-poll-seconds');
	});

	it('is down when NVIDIA accepts the request and never answers inside the rung\'s cap', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			nvidia.respond = (init) =>
				new Promise((_, reject) => {
					init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
				});
			const pending = probe();
			await vi.advanceTimersByTimeAsync(NIM_FLUX_TIMEOUT_MS + 1);
			const r = await pending;
			expect(r.status).toBe('down');
			expect(r.detail).toMatch(/no answer/i);
		} finally {
			vi.useRealTimers();
		}
	});

	it('is down when the pinned model is no longer served', async () => {
		nvidia.respond = () => json(404, { detail: 'Not Found' });
		const r = await probe();
		expect(r).toMatchObject({ status: 'down', http_status: 404 });
		expect(r.detail).toMatch(/no longer served/i);
	});

	it('is degraded when NVIDIA answers 200 with no image, or withholds it', async () => {
		nvidia.respond = () => json(200, { artifacts: [] });
		expect((await probe()).status).toBe('degraded');
		nvidia.respond = () => finished('CONTENT_FILTERED');
		const r = await probe();
		expect(r.status).toBe('degraded');
		expect(r.detail).toMatch(/CONTENT_FILTERED/);
	});

	it('reports unconfigured, without a call, when there is no key', async () => {
		delete process.env.NVIDIA_API_KEY;
		expect((await probe()).status).toBe('unconfigured');
		expect(nvidia.calls).toHaveLength(0);
	});
});
