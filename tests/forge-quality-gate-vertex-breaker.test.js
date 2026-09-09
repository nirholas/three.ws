// The quality gate's Vertex rung is health-gated.
//
// Under a project-wide billing denial Vertex answers 403 to every request until
// ops restores billing. Without a breaker the gate spent attempt-0 of every
// single generation on that lane, and on production (2026-09-09, live hold)
// 5 of 10 scoring calls returned no verdict at all. These tests pin the fix:
// the first 403 parks the lane for the auth window, and the next call skips it
// and scores on the free non-GCP chain instead.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const VERDICT = {
	score: 78,
	realism: 70,
	completeness: 85,
	defects: [],
	reason: 'clean model',
};

const describeImageJson = vi.fn(async () => ({
	json: VERDICT,
	provider: 'nvidia',
	model: 'meta/llama-3.2-11b-vision-instruct',
}));

vi.mock('../api/_lib/vision.js', () => ({
	describeImageJson: (...args) => describeImageJson(...args),
	visionConfigured: () => true,
	parseJsonLoose: (text) => JSON.parse(text),
}));

vi.mock('../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: async () => 'test-token',
}));

let runQualityGate;
let clearProviderCooldown;
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;
const PNG_1PX =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
	globalThis.fetch = fetchSpy;
	({ runQualityGate } = await import('../api/_lib/forge-quality-gate.js'));
	({ clearProviderCooldown } = await import('../api/_lib/provider-health.js'));
});

afterAll(() => {
	globalThis.fetch = realFetch;
	delete process.env.GOOGLE_CLOUD_PROJECT;
});

beforeEach(async () => {
	fetchSpy.mockReset();
	describeImageJson.mockClear();
	await clearProviderCooldown('forge-quality:vertex');
});

function vertexDenied() {
	return {
		ok: false,
		status: 403,
		text: async () =>
			JSON.stringify({ error: { code: 403, message: 'Lightning dunning decision is deny for project', status: 'PERMISSION_DENIED' } }),
	};
}

function score() {
	return runQualityGate({ renderBase64: PNG_1PX, mimeType: 'image/png', prompt: 'a ceramic teapot' });
}

describe('quality gate, Vertex circuit breaker', () => {
	it('still scores through the free non-GCP chain when Vertex is denied', async () => {
		fetchSpy.mockResolvedValueOnce(vertexDenied());

		const verdict = await score();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(verdict.qa_available).toBe(true);
		expect(verdict.provider).toBe('nvidia');
		expect(verdict.score).toBe(78);
	});

	it('skips the denied lane on the next call instead of re-probing it', async () => {
		fetchSpy.mockResolvedValueOnce(vertexDenied());
		await score();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		const second = await score();

		// The breaker parked Vertex, so no second request left the process.
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(describeImageJson).toHaveBeenCalledTimes(2);
		expect(second.qa_available).toBe(true);
		expect(second.provider).toBe('nvidia');
	});

	it('clears the park as soon as Vertex answers again', async () => {
		fetchSpy.mockResolvedValueOnce(vertexDenied());
		await score();

		await clearProviderCooldown('forge-quality:vertex');
		fetchSpy.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(VERDICT) }] } }] }),
		});

		const verdict = await score();

		expect(verdict.qa_available).toBe(true);
		expect(verdict.provider).toBe('vertex');
	});
});
