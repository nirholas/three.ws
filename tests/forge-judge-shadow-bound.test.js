// The Cosmos shadow judge observes; it never decides, and it cannot pile up.
//
// Shadow mode runs a second judge beside the shipped one purely to log what it
// would have said. Two guarantees are pinned here: nothing it does (hang, fail,
// answer garbage) changes the verdict delivery sees, and the work it can have in
// flight is capped and time-boxed, so a dead Cosmos worker during a burst of
// generations cannot queue renders and calls without limit.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const CURRENT = { score: 72, realism: 65, completeness: 80, defects: [], reason: 'clean model' };
const describeImageJson = vi.fn(async () => ({ json: CURRENT, provider: 'nvidia', model: 'm' }));

vi.mock('../api/_lib/vision.js', async (importOriginal) => ({
	VISION_TASK_LEAD: (await importOriginal()).VISION_TASK_LEAD,
	describeImageJson: (...args) => describeImageJson(...args),
	visionConfigured: () => true,
	parseJsonLoose: (text) => JSON.parse(String(text).match(/\{[\s\S]*\}/)[0]),
}));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const renderAvatarScene = vi.fn(async () => ({ png: PNG }));
vi.mock('../api/_lib/avatar-render.js', () => ({
	renderAvatarScene: (...args) => renderAvatarScene(...args),
	SCENE_PRESETS: { 'full-body': { name: 'full-body' } },
}));

const inserts = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		inserts.push({ text: strings.join('?'), values });
		return Promise.resolve([{ id: inserts.length }]);
	},
}));
vi.mock('../api/_lib/r2.js', () => ({ putObject: async () => {} }));
vi.mock('../api/_lib/ssrf.js', async (orig) => ({ ...(await orig()), assertPublicHttpsUrl: async (u) => new URL(u) }));
vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'test-token' }));

let gate;
const realFetch = globalThis.fetch;
const fetchSpy = vi.fn();
const GLB = 'https://three.ws/cdn/m/test.glb';
const ENV = {
	COSMOS_REASON_URL: 'https://model-cosmos-reason.example.run.app',
	COSMOS_REASON_KEY: 'test-bearer',
	FORGE_COSMOS_SHADOW_GRACE_MS: '40',
	FORGE_COSMOS_SHADOW_MAX_INFLIGHT: '2',
	FORGE_COSMOS_HARD_DEADLINE_MS: '600',
};

beforeAll(async () => {
	Object.assign(process.env, ENV);
	delete process.env.GOOGLE_CLOUD_PROJECT;
	delete process.env.FORGE_COSMOS_JUDGE;
	globalThis.fetch = fetchSpy;
	gate = await import('../api/_lib/forge-quality-gate.js');
});

afterAll(() => {
	globalThis.fetch = realFetch;
	for (const k of Object.keys(ENV)) delete process.env[k];
});

beforeEach(async () => {
	fetchSpy.mockReset();
	describeImageJson.mockClear();
	renderAvatarScene.mockClear();
	inserts.length = 0;
	// Let any run a previous test left hanging reach its hard deadline first.
	await vi.waitFor(() => expect(gate.cosmosRunsInFlight()).toBe(0), { timeout: 5000 });
});

const cosmosReply = (content) =>
	new Response(JSON.stringify({ choices: [{ message: { content } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('shadow mode never affects delivery', () => {
	it('returns exactly the current verdict when Cosmos hangs', async () => {
		fetchSpy.mockImplementation(() => new Promise(() => {}));
		const t0 = Date.now();
		const verdict = await gate.runQualityGate({ glbUrl: GLB, prompt: 'a robot' });
		expect(verdict.pass).toBe(true);
		expect(verdict.score).toBe(72);
		expect(verdict.judge).toBeUndefined();
		// Bounded: the current judge plus the short grace, not Cosmos's own timeout.
		expect(Date.now() - t0).toBeLessThan(3000);
	});

	it('returns exactly the current verdict when Cosmos errors', async () => {
		fetchSpy.mockRejectedValue(new Error('connect ECONNREFUSED'));
		const verdict = await gate.runQualityGate({ glbUrl: GLB, prompt: 'a robot' });
		expect(verdict).toMatchObject({ pass: true, score: 72, qa_available: true });
	});

	it('returns exactly the current verdict when Cosmos answers garbage', async () => {
		fetchSpy.mockResolvedValue(cosmosReply('I think it is probably fine!'));
		const verdict = await gate.runQualityGate({ glbUrl: GLB, prompt: 'a robot' });
		expect(verdict).toMatchObject({ pass: true, score: 72 });
	});

	it('does not even let a Cosmos that says FAIL change a passing delivery', async () => {
		fetchSpy.mockResolvedValue(cosmosReply('{"plausible": false, "issues": ["floating_parts"], "prompt_match": "no", "confidence": 0.99}'));
		const verdict = await gate.runQualityGate({ glbUrl: GLB, prompt: 'a robot' });
		expect(verdict.pass).toBe(true);
		expect(verdict.judge).toBeUndefined();
	});
});

describe('shadow mode cannot pile up unbounded work', () => {
	it('starts no more than the in-flight cap when Cosmos is hung, however many requests arrive', async () => {
		fetchSpy.mockImplementation(() => new Promise(() => {}));
		const verdicts = await Promise.all(Array.from({ length: 6 }, () => gate.runQualityGate({ glbUrl: GLB, prompt: 'a robot' })));
		// Every one of the six still got the current judge's verdict...
		for (const v of verdicts) expect(v).toMatchObject({ pass: true, score: 72 });
		// ...but only two shadow runs were started: two Cosmos calls, and four extra
		// renders each. The other four requests did no shadow work at all.
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(renderAvatarScene).toHaveBeenCalledTimes(6 + 2 * 4);
		expect(gate.cosmosRunsInFlight()).toBeLessThanOrEqual(2);
	});

	it('releases a hung run at its hard deadline so the cap frees up again', async () => {
		fetchSpy.mockImplementation(() => new Promise(() => {}));
		await Promise.all([gate.runQualityGate({ glbUrl: GLB }), gate.runQualityGate({ glbUrl: GLB })]);
		expect(gate.cosmosRunsInFlight()).toBe(2);
		await vi.waitFor(() => expect(gate.cosmosRunsInFlight()).toBe(0), { timeout: 5000 });
		// A fresh request shadows again.
		fetchSpy.mockReset();
		fetchSpy.mockResolvedValue(cosmosReply('{"plausible": true, "issues": [], "prompt_match": "yes", "confidence": 0.9}'));
		await gate.runQualityGate({ glbUrl: GLB });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('counts a run that finishes normally back out', async () => {
		fetchSpy.mockResolvedValue(cosmosReply('{"plausible": true, "issues": [], "prompt_match": "yes", "confidence": 0.9}'));
		await gate.runQualityGate({ glbUrl: GLB });
		await vi.waitFor(() => expect(gate.cosmosRunsInFlight()).toBe(0), { timeout: 2000 });
	});
});
