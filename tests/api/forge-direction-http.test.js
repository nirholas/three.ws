// HTTP boundary for the Forge direction step (api/forge.js).
//
// When the art director cannot help (every chat model refusing or cooling down,
// a refusal, an off-topic rewrite) the user's own prompt must paint the
// reference image, and the response and the progress crumb must say direction
// was SKIPPED and why. Before 2026-11-26 the handler swallowed the reason: the
// response carried only `directed_prompt: null`, which the page rendered as
// "The director left it unchanged", a claim that the director ran when it never
// answered. A rewrite that did land must still be reported as directed.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

const state = vi.hoisted(() => ({ director: null, painted: [], crumbs: [] }));

// The director client: the boundary under test is what forge.js does with its
// answer, so each case scripts what the chain reported.
vi.mock('../../api/_mcp-studio/forge-client.js', async (orig) => ({
	...(await orig()),
	directPrompt: async (_system, raw, { onFallback } = {}) => state.director(raw, onFallback),
}));

vi.mock('../../api/_lib/forge-progress.js', async (orig) => ({
	...(await orig()),
	recordForgeProgress: async (_id, stage, data) => {
		state.crumbs.push({ stage, ...data });
	},
}));

vi.mock('../../api/_lib/forge-reference-image.js', () => ({
	generateReferenceImage: async (prompt) => {
		state.painted.push(prompt);
		return { imageUrl: 'https://cdn.test/reference.png', model: 'vertex/imagen' };
	},
}));

vi.mock('../../api/_providers/huggingface.js', () => ({
	createRegenProvider: () => ({
		submit: async () => ({ extJobId: 'hf-job' }),
		status: async () => ({ status: 'done', resultGlbUrl: 'https://cdn.test/model.glb' }),
	}),
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

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFreeTiered: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.46',
	};
});

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		NVIDIA_API_KEY: 'test-nvidia-key',
		HF_TOKEN: 'test-hf-token',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
	delete process.env.FORGE_REFERENCE_IMAGE;
});

beforeEach(() => {
	state.painted = [];
	state.crumbs = [];
});

const { default: handler } = await import('../../api/forge.js');

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'x-vercel-ip-country': 'US' },
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

const TRACE = 'trace_direction_http_0001';

describe('POST /api/forge direction record', () => {
	it('a cooled chain paints the raw prompt and reports direction skipped with its reason', async () => {
		state.director = (_raw, onFallback) => {
			onFallback?.({ reason: 'chain_cooling' });
			return null;
		};
		const res = makeRes();
		await handler(makeReq({ prompt: 'a red ceramic mug', tier: 'standard', path: 'image', progress_id: TRACE }), res);

		expect(res.statusCode).toBe(200);
		expect(state.painted[0]).toBe('a red ceramic mug');
		expect(res.body.directed_prompt).toBeNull();
		expect(res.body.direction).toMatchObject({ status: 'skipped', reason: 'chain_cooling' });
		expect(typeof res.body.direction.ms).toBe('number');
		const crumb = state.crumbs.find((c) => c.stage === 'directed');
		expect(crumb.direction).toMatchObject({ status: 'skipped', reason: 'chain_cooling' });
	});

	it('a rewrite that landed paints the brief and reports direction directed', async () => {
		const brief = 'A glossy red ceramic mug with a looped handle, centered on a light-grey sweep, soft studio light.';
		state.director = () => brief;
		const res = makeRes();
		await handler(makeReq({ prompt: 'a red ceramic mug', tier: 'standard', path: 'image', progress_id: TRACE }), res);

		expect(res.statusCode).toBe(200);
		expect(state.painted[0]).toBe(brief);
		expect(res.body.directed_prompt).toBe(brief);
		expect(res.body.direction).toMatchObject({ status: 'directed' });
	});

	it('director:false is reported as off, not as an unchanged rewrite', async () => {
		state.director = () => {
			throw new Error('must not be called');
		};
		const res = makeRes();
		await handler(makeReq({ prompt: 'a red ceramic mug', tier: 'standard', path: 'image', director: false }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.direction).toEqual({ status: 'off' });
		expect(state.painted[0]).toBe('a red ceramic mug');
	});
});
