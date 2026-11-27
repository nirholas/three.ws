// POST /api/forge-enhance (the page's Enhance button) when the chat chain is
// down, driven through the REAL chain in api/_lib/llm.js with only the network
// stubbed, configured the way production was on 2026-11-26: Vertex Gemini lane
// on, Vertex Claude primary, Groq, OpenRouter, NVIDIA, Hugging Face, OpenAI.
//
// Before the fix a dead chain cost the direct Vertex lane's 8 s plus the
// chain's default 30 s, came back as 502 "Could not enhance the prompt. Try
// again.", and the next click asked every refusing provider again. A refusal
// or an off-topic reply was handed back as the "enhanced" prompt.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: vi.fn(async () => 'gcp-token') }));
vi.mock('../../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { forgeEnhance: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '203.0.113.8'),
}));

const handler = (await import('../../api/forge-enhance.js')).default;
const { resetLlmCooldowns } = await import('../../api/_lib/llm.js');

const PROD_ENV = {
	GOOGLE_CLOUD_PROJECT: 'three-ws-test',
	VERTEX_CLAUDE_ENABLED: '1',
	VERTEX_CLAUDE_PRIMARY: '1',
	OPENROUTER_API_KEY: 'or-key',
	GROQ_API_KEY: 'groq-key',
	OPENAI_API_KEY: 'oa-key',
	HF_TOKEN: 'hf-key',
	NVIDIA_API_KEY: 'nvapi-key',
};
const CLEARED = [
	'WATSONX_API_KEY',
	'OPENROUTER_FALLBACK_KEYS',
	'NVIDIA_FALLBACK_KEYS',
	'HF_FALLBACK_TOKENS',
	'CEREBRAS_API_KEY',
	'SAMBANOVA_API_KEY',
	'MISTRAL_API_KEY',
	'ZAI_API_KEY',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_AI_API_TOKEN',
	'GEMINI_API_KEY',
	'SILICONFLOW_API_KEY',
	'ANTHROPIC_API_KEY',
	'GROK_API_KEY',
	'KILO_API_KEY',
	'LLM7_API_KEY',
	'PHI_URL',
	'PHI_LANE_URL',
	'FORGE_ENHANCE_VERTEX',
	'FORGE_ENHANCE_BUDGET_MS',
	'LLM_ROUTE_FORGE_ENHANCE',
];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
// The three refusals observed in production on 2026-11-26.
function refusalFor(host) {
	if (host.includes('openrouter.ai')) return json(402, { error: { message: 'Insufficient credits', code: 402 } });
	if (host.includes('api.openai.com')) return json(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '20' });
	if (host.includes('googleapis.com')) return json(403, { error: { code: 403, message: 'Billing account is disabled' } });
	if (host.includes('huggingface') || host.includes('nvidia.com')) return json(402, { error: 'out of credit' });
	return json(429, { error: { message: 'Rate limit reached' } });
}
const reply = (text) =>
	json(200, { choices: [{ message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 20 } }, {
		'content-type': 'application/json',
	});

function routeFetch(handlerFn) {
	const calls = [];
	globalThis.fetch = vi.fn(async (url, opts = {}) => {
		const host = new URL(String(url)).host;
		calls.push(host);
		return handlerFn(host, opts);
	});
	return calls;
}

function mkReq(body) {
	const stream = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
	stream.method = 'POST';
	stream.url = '/api/forge-enhance';
	stream.headers = { 'content-type': 'application/json' };
	return stream;
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		end(chunk) {
			if (chunk !== undefined) this.body += String(chunk);
			this.writableEnded = true;
		},
	};
}
async function enhance(prompt) {
	const res = mkRes();
	const t0 = Date.now();
	await handler(mkReq({ prompt }), res);
	return { status: res.statusCode, body: JSON.parse(res.body || '{}'), ms: Date.now() - t0 };
}

beforeEach(() => {
	for (const k of [...Object.keys(PROD_ENV), ...CLEARED]) saved[k] = process.env[k];
	for (const k of CLEARED) delete process.env[k];
	Object.assign(process.env, PROD_ENV);
	resetLlmCooldowns();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

describe('Enhance with the whole chain refusing', () => {
	it('says the helper is unavailable in under a second and hands the prompt back unchanged', async () => {
		routeFetch(refusalFor);
		const out = await enhance('a rocking chair');
		expect(out.ms).toBeLessThan(1000);
		expect(out.status).toBe(503);
		expect(out.body.error).toBe('llm_unavailable');
		expect(out.body.prompt).toBe('a rocking chair');
		expect(out.body.enhanced).toBe(false);
		expect(out.body.error_description).toMatch(/unavailable/i);
		expect(out.body.error_description).not.toMatch(/try again|tweak/i);
	});

	it('the next click makes no network call at all and states when to retry', async () => {
		routeFetch(refusalFor);
		await enhance('a rocking chair');
		const second = routeFetch(refusalFor);
		const out = await enhance('a brass lantern');
		expect(second).toEqual([]);
		expect(out.ms).toBeLessThan(250);
		expect(out.status).toBe(503);
		expect(out.body).toMatchObject({ error: 'llm_unavailable', prompt: 'a brass lantern', enhanced: false });
		expect(out.body.retry_after).toBeGreaterThan(0);
	});

	it('a stalled chain is cut off at the enhance budget', async () => {
		process.env.FORGE_ENHANCE_BUDGET_MS = '2000';
		routeFetch(
			(_host, opts) =>
				new Promise((_, reject) => {
					opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
				}),
		);
		const out = await enhance('a rocking chair');
		expect(out.status).toBe(503);
		expect(out.body.prompt).toBe('a rocking chair');
		expect(out.ms).toBeLessThan(3000);
	}, 10_000);
});

describe('a bad rewrite is discarded in favor of the user prompt', () => {
	// Vertex off so Groq (the first free rung) answers with the scripted reply.
	const answerWith = (text) => {
		process.env.FORGE_ENHANCE_VERTEX = 'off';
		routeFetch((host) => (host.includes('groq.com') ? reply(text) : refusalFor(host)));
	};
	const cases = {
		empty: ' "" ',
		too_long: `A rocking chair ${'with richly carved and polished oak spindles '.repeat(30)}`,
		refusal: "I'm sorry, but I can't help with that request.",
		off_topic: 'A brushed aluminium desk lamp with a weighted round base, centered on a seamless light-grey sweep',
	};
	for (const [reason, text] of Object.entries(cases)) {
		it(`${reason}: returns the user prompt, marked not enhanced`, async () => {
			answerWith(text);
			const out = await enhance('a rocking chair');
			expect(out.status).toBe(200);
			expect(out.body).toMatchObject({ prompt: 'a rocking chair', enhanced: false, reason });
		});
	}

	it('a good rewrite is returned and marked enhanced', async () => {
		answerWith('A worn oak rocking chair with curved runners, centered on a seamless light-grey sweep, soft even light');
		const out = await enhance('a rocking chair');
		expect(out.status).toBe(200);
		expect(out.body.enhanced).toBe(true);
		expect(out.body.prompt).toMatch(/^A worn oak rocking chair/);
	});
});
