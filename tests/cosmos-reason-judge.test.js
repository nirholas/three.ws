// NVIDIA Cosmos Reason physical-plausibility judge for the Forge quality gate.
//
// Pins: the reasoning trace never survives into a verdict, the issue list stays
// the fixed vocabulary, every failure is fail-open, the promotion modes decide
// exactly as documented, and shadow mode logs both verdicts while returning the
// current judge's verdict unchanged.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const CURRENT = { score: 72, realism: 65, completeness: 80, defects: [], reason: 'clean model' };
const describeImageJson = vi.fn(async () => ({ json: CURRENT, provider: 'cloudflare', model: '@cf/meta/llama-4-scout' }));

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
const puts = [];
vi.mock('../api/_lib/r2.js', () => ({
	putObject: async (o) => { puts.push(o.key); },
}));

// The current judge resolves the GLB host before rendering; the test host is synthetic.
vi.mock('../api/_lib/ssrf.js', async (orig) => ({ ...(await orig()), assertPublicHttpsUrl: async (u) => new URL(u) }));

vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'test-token' }));

let judge;
let gate;
const realFetch = globalThis.fetch;
const fetchSpy = vi.fn();

function cosmosReply(content) {
	return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 40 } }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

beforeAll(async () => {
	process.env.COSMOS_REASON_URL = 'https://model-cosmos-reason.example.run.app';
	process.env.COSMOS_REASON_KEY = 'test-bearer';
	delete process.env.GOOGLE_CLOUD_PROJECT;
	globalThis.fetch = fetchSpy;
	judge = await import('../api/_lib/cosmos-reason-judge.js');
	gate = await import('../api/_lib/forge-quality-gate.js');
});

afterAll(() => {
	globalThis.fetch = realFetch;
	delete process.env.COSMOS_REASON_URL;
	delete process.env.COSMOS_REASON_KEY;
	delete process.env.FORGE_COSMOS_JUDGE;
});

beforeEach(() => {
	fetchSpy.mockReset();
	describeImageJson.mockClear();
	renderAvatarScene.mockClear();
	inserts.length = 0;
	puts.length = 0;
	delete process.env.FORGE_COSMOS_JUDGE;
	delete process.env.FORGE_COSMOS_VETO_ISSUES;
});

describe('stripReasoning', () => {
	it('drops a closed think block and unwraps the answer', () => {
		const out = judge.stripReasoning('<think>the left arm floats, so...</think>\n<answer>{"plausible": false}</answer>');
		expect(out).toBe('{"plausible": false}');
		expect(out).not.toContain('floats');
	});
	it('drops an unclosed (truncated) think block entirely', () => {
		expect(judge.stripReasoning('{"plausible": true} <think>and then')).toBe('{"plausible": true}');
	});
	it('passes plain JSON through', () => {
		expect(judge.stripReasoning(' {"plausible": true} ')).toBe('{"plausible": true}');
	});
});

describe('normalizeCosmosVerdict', () => {
	it('keeps only the fixed issue vocabulary and normalizes spelling', () => {
		const v = judge.normalizeCosmosVerdict({
			plausible: 'false',
			issues: ['Floating Parts', 'melted-blob', 'bad vibes', 'floating_parts'],
			prompt_match: 'Partial',
			confidence: 85,
		});
		expect(v).toEqual({ plausible: false, issues: ['floating_parts', 'melted_blob'], prompt_match: 'partial', confidence: 0.85, pass: false });
	});
	it('fails a plausible model that is not the requested subject', () => {
		expect(judge.normalizeCosmosVerdict({ plausible: true, issues: [], prompt_match: 'no', confidence: 0.9 }).pass).toBe(false);
	});
	it('throws when there is no plausible flag, so nothing is invented', () => {
		expect(() => judge.normalizeCosmosVerdict({ issues: [] })).toThrow(/plausible/);
	});
});

describe('buildCosmosJudgePrompt', () => {
	it('names every view and every allowed issue tag', () => {
		const p = judge.buildCosmosJudgePrompt({ prompt: 'a wooden chair' });
		for (const v of ['front', 'right', 'back', 'left']) expect(p).toContain(v);
		for (const k of judge.COSMOS_ISSUE_KEYS) expect(p).toContain(k);
		expect(p).toContain('"a wooden chair"');
	});
});

describe('judgeWithCosmos', () => {
	const views = [{ name: 'front', base64: PNG.toString('base64'), mimeType: 'image/png' }];

	it('sends every view with the bearer and returns the verdict without the trace', async () => {
		fetchSpy.mockResolvedValueOnce(cosmosReply('<think>legs pass through the seat</think><answer>{"plausible": false, "issues": ["interpenetration"], "prompt_match": "yes", "confidence": 0.8}</answer>'));
		const v = await judge.judgeWithCosmos({ views, prompt: 'a chair' });
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://model-cosmos-reason.example.run.app/v1/chat/completions');
		expect(init.headers.authorization).toBe('Bearer test-bearer');
		const body = JSON.parse(init.body);
		expect(body.messages[1].content.filter((c) => c.type === 'image_url')).toHaveLength(1);
		expect(v).toMatchObject({ available: true, plausible: false, issues: ['interpenetration'], pass: false, tokens: { input: 1200, output: 40 } });
		expect(JSON.stringify(v)).not.toContain('seat');
	});

	it('fails open on an HTTP error', async () => {
		fetchSpy.mockResolvedValueOnce(new Response('upstream busy', { status: 503 }));
		const v = await judge.judgeWithCosmos({ views });
		expect(v.available).toBe(false);
		expect(v.error).toMatch(/503/);
	});

	it('fails open on an unparseable answer', async () => {
		fetchSpy.mockResolvedValueOnce(cosmosReply('{"issues": []}'));
		expect((await judge.judgeWithCosmos({ views })).available).toBe(false);
	});
});

describe('cosmosJudgeMode', () => {
	it('defaults to shadow when configured and treats an unknown value as shadow', () => {
		expect(judge.cosmosJudgeMode()).toBe('shadow');
		process.env.FORGE_COSMOS_JUDGE = 'primray';
		expect(judge.cosmosJudgeMode()).toBe('shadow');
		process.env.FORGE_COSMOS_JUDGE = 'Veto';
		expect(judge.cosmosJudgeMode()).toBe('veto');
	});
});

describe('combineJudgeVerdicts', () => {
	const pass = { pass: true, score: 80, qa_available: true, defects: [] };
	const borderline = { pass: true, score: 62, qa_available: true, defects: [] };
	const reject = { available: true, pass: false, plausible: false, issues: ['floating_parts'], prompt_match: 'yes', confidence: 0.9 };

	it('never changes the decision in shadow or off', () => {
		expect(judge.combineJudgeVerdicts(pass, reject, { mode: 'shadow' })).toEqual({ verdict: pass, applied: 'current' });
		expect(judge.combineJudgeVerdicts(pass, reject, { mode: 'off' }).applied).toBe('current');
	});
	it('keeps the current verdict when Cosmos is unavailable in every mode', () => {
		for (const mode of ['veto', 'tiebreak', 'primary']) {
			expect(judge.combineJudgeVerdicts(pass, { available: false }, { mode }).applied).toBe('current');
		}
	});
	it('vetoes only on a confident rejection naming a veto issue', () => {
		const vetoed = judge.combineJudgeVerdicts(pass, reject, { mode: 'veto', vetoIssues: ['floating_parts'] });
		expect(vetoed.applied).toBe('cosmos');
		expect(vetoed.verdict.pass).toBe(false);
		expect(vetoed.verdict.defects).toContain('floating_parts');
		expect(judge.combineJudgeVerdicts(pass, { ...reject, confidence: 0.5 }, { mode: 'veto', vetoIssues: ['floating_parts'] }).applied).toBe('current');
		expect(judge.combineJudgeVerdicts(pass, reject, { mode: 'veto', vetoIssues: ['melted_blob'] }).applied).toBe('current');
	});
	it('tie-breaks only inside the borderline band or when the current judge is down', () => {
		expect(judge.combineJudgeVerdicts(pass, reject, { mode: 'tiebreak', passScore: 60, band: 10 }).applied).toBe('current');
		expect(judge.combineJudgeVerdicts(borderline, reject, { mode: 'tiebreak', passScore: 60, band: 10 }).verdict.pass).toBe(false);
		expect(judge.combineJudgeVerdicts({ pass: true, qa_available: false }, reject, { mode: 'tiebreak' }).applied).toBe('cosmos');
	});
	it('lets Cosmos decide in primary', () => {
		expect(judge.combineJudgeVerdicts(pass, reject, { mode: 'primary' }).verdict.pass).toBe(false);
	});
});

describe('runQualityGate with Cosmos in shadow', () => {
	it('logs both verdicts and the four views, and returns the current verdict unchanged', async () => {
		fetchSpy.mockImplementation(async (url) => {
			if (String(url).includes('model-cosmos-reason')) {
				return cosmosReply('{"plausible": false, "issues": ["floating_parts"], "prompt_match": "yes", "confidence": 0.9}');
			}
			throw new Error(`unexpected fetch ${url}`);
		});
		const verdict = await gate.runQualityGate({ glbUrl: 'https://cdn.three.ws/m/test.glb', prompt: 'a robot', creationId: 'c-123' });
		expect(verdict.pass).toBe(true);
		expect(verdict.score).toBe(72);
		expect(verdict.judge).toBeUndefined();
		// one front render for the current judge, four for Cosmos
		expect(renderAvatarScene).toHaveBeenCalledTimes(5);
		expect(puts).toHaveLength(4);
		expect(puts[0]).toMatch(/^forge\/judge-shadow\/forge\/\d{4}-\d{2}-\d{2}\/c-123\/front\.png$/);
		expect(inserts).toHaveLength(1);
		const values = inserts[0].values;
		expect(values).toContain('shadow');
		expect(values).toContain(true); // disagree
		const cosmos = JSON.parse(values.find((v) => typeof v === 'string' && v.includes('floating_parts')));
		expect(cosmos).toMatchObject({ available: true, pass: false, issues: ['floating_parts'] });
	});

	it('applies a veto when promoted, and still logs the row', async () => {
		process.env.FORGE_COSMOS_JUDGE = 'veto';
		process.env.FORGE_COSMOS_VETO_ISSUES = 'floating_parts';
		fetchSpy.mockResolvedValue(cosmosReply('{"plausible": false, "issues": ["floating_parts"], "prompt_match": "yes", "confidence": 0.95}'));
		const verdict = await gate.runQualityGate({ glbUrl: 'https://cdn.three.ws/m/test.glb', prompt: 'a robot' });
		expect(verdict.pass).toBe(false);
		expect(verdict.judge).toBe('cosmos-reason');
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toContain('cosmos');
	});

	it('is skipped entirely when the gate only has a render, not a GLB', async () => {
		await gate.runQualityGate({ renderBase64: PNG.toString('base64'), prompt: 'a robot' });
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(inserts).toHaveLength(0);
	});
});
