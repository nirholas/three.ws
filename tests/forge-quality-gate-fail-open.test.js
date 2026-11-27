// The vision quality gate can only ever help. Whatever the judge does (be
// unreachable, hang, or answer with something that is not a verdict), the model
// is delivered: the gate returns a passing, qa_available:false verdict, and it
// does so inside a bounded time.
//
// One test per failure mode. Only the network edge is stubbed (the vision chain
// and Vertex's token); the gate, its normalizer and its deadline are the real code.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const describeImageJson = vi.fn();

vi.mock('../api/_lib/vision.js', async (importOriginal) => ({
	VISION_TASK_LEAD: (await importOriginal()).VISION_TASK_LEAD,
	describeImageJson: (...args) => describeImageJson(...args),
	visionConfigured: () => true,
	parseJsonLoose: (text) => JSON.parse(text),
}));

vi.mock('../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: async () => 'test-token',
}));

const PNG_1PX =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let runQualityGate;
let runCurrentJudge;
const realProject = process.env.GOOGLE_CLOUD_PROJECT;
const realCosmos = process.env.COSMOS_REASON_URL;

beforeAll(async () => {
	// No Vertex project and no Cosmos: the platform vision chain is the only judge.
	delete process.env.GOOGLE_CLOUD_PROJECT;
	delete process.env.COSMOS_REASON_URL;
	({ runQualityGate, runCurrentJudge } = await import('../api/_lib/forge-quality-gate.js'));
});

afterAll(() => {
	if (realProject !== undefined) process.env.GOOGLE_CLOUD_PROJECT = realProject;
	if (realCosmos !== undefined) process.env.COSMOS_REASON_URL = realCosmos;
});

beforeEach(() => describeImageJson.mockReset());

const score = (extra = {}) =>
	runQualityGate({ renderBase64: PNG_1PX, mimeType: 'image/png', prompt: 'a ceramic teapot', ...extra });

function expectFailOpen(verdict) {
	expect(verdict.pass).toBe(true);
	expect(verdict.qa_available).toBe(false);
	expect(verdict.score).toBeNull();
	expect(verdict.suggested_retry_hint).toBeNull();
}

describe('quality gate fails open', () => {
	it('when the judge is unreachable (every rung rejects)', async () => {
		describeImageJson.mockRejectedValue(Object.assign(new Error('fetch failed'), { lanes: [{ provider: 'nvidia', status: 503 }] }));
		const verdict = await score();
		expectFailOpen(verdict);
		expect(verdict.reason).toMatch(/scoring failed/);
	});

	it('when the judge hangs, inside the deadline it was given', async () => {
		describeImageJson.mockImplementation(() => new Promise(() => {}));
		const t0 = Date.now();
		const verdict = await score({ deadlineMs: 80 });
		const took = Date.now() - t0;
		expectFailOpen(verdict);
		expect(verdict.reason).toMatch(/80ms/);
		expect(took).toBeLessThan(1500);
	});

	it('bounds the deadline for the current judge too, not only the Cosmos wrapper', async () => {
		describeImageJson.mockImplementation(() => new Promise(() => {}));
		const t0 = Date.now();
		const verdict = await runCurrentJudge({ renderBase64: PNG_1PX, prompt: 'a chair', deadlineMs: 60 });
		expectFailOpen(verdict);
		expect(Date.now() - t0).toBeLessThan(1500);
	});

	it('when the render cannot be obtained', async () => {
		const verdict = await score({ renderBase64: null, glbUrl: 'https://127.0.0.1/never.glb' });
		expectFailOpen(verdict);
		expect(verdict.reason).toMatch(/render/);
		expect(describeImageJson).not.toHaveBeenCalled();
	});

	// A reply that parses as JSON but is not a verdict used to fail the model
	// (a null score became pass:false, which then paid for a retry on the strength
	// of nothing). Each of these is the judge talking nonsense, not a quality call.
	const nonsense = {
		'an empty object': {},
		'a non-numeric score': { score: 'banana', realism: 'high' },
		'a null score': { score: null, reason: 'could not tell' },
		'an empty-string score': { score: '' },
		'an array': [1, 2, 3],
		'a bare string': 'looks great to me',
		'a bare number': 42,
		'a score that is not finite': { score: Infinity },
	};
	for (const [label, json] of Object.entries(nonsense)) {
		it(`when the judge answers with ${label}`, async () => {
			describeImageJson.mockResolvedValue({ json, provider: 'nvidia', model: 'm' });
			const verdict = await score();
			expectFailOpen(verdict);
			expect(verdict.reason).toMatch(/usable score|verdict/);
		});
	}

	it('control: a real low score still fails, so the tests above are not passing by accident', async () => {
		describeImageJson.mockResolvedValue({
			json: { score: 20, realism: 20, completeness: 60, defects: ['blob'], reason: 'melted' },
			provider: 'nvidia',
			model: 'm',
		});
		const verdict = await score();
		expect(verdict.qa_available).toBe(true);
		expect(verdict.pass).toBe(false);
		expect(verdict.score).toBe(20);
	});

	it('control: a real passing score passes with its score', async () => {
		describeImageJson.mockResolvedValue({
			json: { score: 81, realism: 80, completeness: 90, defects: [], reason: 'clean' },
			provider: 'nvidia',
			model: 'm',
		});
		const verdict = await score();
		expect(verdict.qa_available).toBe(true);
		expect(verdict.pass).toBe(true);
		expect(verdict.score).toBe(81);
	});
});
