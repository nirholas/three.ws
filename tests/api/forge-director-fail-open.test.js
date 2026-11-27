// The Forge art director must fail OPEN: it is a quality lever in front of the
// reference painter, never a requirement. On 2026-11-26 every provider in the
// chat chain refused at once (OpenRouter 402 out of credits, OpenAI 429
// throttled, Vertex 403 behind a billing hold). These tests drive the REAL chain
// in api/_lib/llm.js with only the network boundary stubbed, configured the way
// production is (Vertex Claude primary, Groq, OpenRouter, NVIDIA, Hugging Face,
// OpenAI, plus the keyless rungs), and pin three promises:
//
//   1. a dead chain hands the user's own prompt back in well under a second;
//   2. the NEXT request makes no call at all to a provider that is cooling down;
//   3. a stalled chain is cut off at the director's own short budget, so an
//      optional rewrite can never hold a generation for the old 20 s + 20 s.
//
// It also proves the NVIDIA-hosted chat rung serves the director when every
// rung in front of it refuses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: vi.fn(async () => 'gcp-token') }));
// The spend ledger write is fire-and-forget; keep it off the database.
vi.mock('../../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));

const { directPrompt, DIRECTOR_BUDGET_MS, directorBudgetMs } = await import('../../api/_mcp-studio/forge-client.js');
const gpt = await import('../../api/_mcp-studio/gpt-forge-client.js');
const { directForReference } = await import('../../api/_lib/forge-direction.js');
const { meshDirectorFor } = await import('../../api/_lib/forge-director-prompts.js');
const { resetLlmCooldowns } = await import('../../api/_lib/llm.js');

// What production had configured on 2026-11-26 (names only, values are fakes).
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
	'WATSONX_PROJECT_ID',
	'WATSONX_SPACE_ID',
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
	'FORGE_DIRECTOR_BUDGET_MS',
	'LLM_ROUTE_FORGE_DIRECTOR',
];
const saved = {};

const SPEC =
	'A weathered oak rocking chair with tight grain and brass-capped runners, centered on a seamless light-grey sweep, soft even studio light, one subject only.';

// The three refusals observed in production, verbatim in status and shape.
const REFUSE_402 = () =>
	new Response(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } }), { status: 402 });
const REFUSE_429 = () =>
	new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
		status: 429,
		headers: { 'retry-after': '20' },
	});
const REFUSE_403 = () =>
	new Response(JSON.stringify({ error: { code: 403, message: 'Billing account is disabled', status: 'PERMISSION_DENIED' } }), {
		status: 403,
	});

// Every outbound host answers with one of the three real refusals.
function refusalFor(host) {
	if (host.includes('openrouter.ai')) return REFUSE_402();
	if (host.includes('api.openai.com')) return REFUSE_429();
	if (host.includes('googleapis.com')) return REFUSE_403();
	if (host.includes('groq.com')) return REFUSE_429();
	if (host.includes('huggingface')) return REFUSE_402();
	if (host.includes('nvidia.com')) return REFUSE_402();
	// Keyless rungs (Kilo, OVH, Pollinations, LLM7): throttled.
	return REFUSE_429();
}

function routeFetch(handler) {
	const calls = [];
	globalThis.fetch = vi.fn(async (url, opts = {}) => {
		const host = new URL(String(url)).host;
		calls.push(host);
		return handler(host, opts);
	});
	return calls;
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	for (const k of [...Object.keys(PROD_ENV), ...CLEARED]) saved[k] = process.env[k];
	for (const k of CLEARED) delete process.env[k];
	Object.assign(process.env, PROD_ENV);
	resetLlmCooldowns();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

const DIRECTOR = meshDirectorFor('object');

describe('director with the whole chat chain refusing', () => {
	it('returns the user prompt in under a second on the first request', async () => {
		const calls = routeFetch((host) => refusalFor(host));
		const reasons = [];
		const t0 = Date.now();
		const out = await directPrompt(DIRECTOR, 'a rocking chair', { onFallback: (f) => reasons.push(f.reason) });
		const ms = Date.now() - t0;
		expect(out).toBeNull();
		expect(ms).toBeLessThan(1000);
		// The first request does ask each provider once: that is how it learns.
		expect(calls.length).toBeGreaterThan(0);
		expect(reasons).toEqual(['chain_failed']);
	});

	it('makes no network call to a cooled provider on the next request', async () => {
		routeFetch((host) => refusalFor(host));
		await directPrompt(DIRECTOR, 'a rocking chair');

		const second = routeFetch((host) => refusalFor(host));
		const reasons = [];
		const t0 = Date.now();
		const out = await directPrompt(DIRECTOR, 'a brass lantern', { onFallback: (f) => reasons.push(f.reason) });
		expect(out).toBeNull();
		expect(Date.now() - t0).toBeLessThan(250);
		expect(second).toEqual([]);
		expect(reasons).toEqual(['chain_cooling']);
	});

	it('the ChatGPT clone skips a cooled chain the same way', async () => {
		routeFetch((host) => refusalFor(host));
		await gpt.directPrompt(DIRECTOR, 'a rocking chair');
		const second = routeFetch((host) => refusalFor(host));
		const reasons = [];
		const out = await gpt.directPrompt(DIRECTOR, 'a brass lantern', { onFallback: (f) => reasons.push(f.reason) });
		expect(out).toBeNull();
		expect(second).toEqual([]);
		expect(reasons).toEqual(['chain_cooling']);
	});

	it('directForReference forwards the raw prompt unchanged and says direction was skipped', async () => {
		routeFetch((host) => refusalFor(host));
		const run = await directForReference('a rocking chair', { direct: directPrompt });
		expect(run.prompt).toBe('a rocking chair');
		expect(run.direction.status).toBe('skipped');
		expect(run.direction.reason).toBe('chain_failed');
		expect(run.direction.ms).toBeLessThan(1000);

		const again = await directForReference('a rocking chair', { direct: directPrompt });
		expect(again.prompt).toBe('a rocking chair');
		expect(again.direction).toMatchObject({ status: 'skipped', reason: 'chain_cooling' });
	});
});

describe('director budget', () => {
	it('defaults to a short budget, far below the old 20 s per leg', () => {
		expect(DIRECTOR_BUDGET_MS).toBeLessThanOrEqual(8_000);
		expect(directorBudgetMs()).toBe(DIRECTOR_BUDGET_MS);
	});

	it('cuts a stalled chain off at the budget instead of waiting on every rung', async () => {
		process.env.FORGE_DIRECTOR_BUDGET_MS = '2000';
		// Every host accepts the request and never answers until aborted.
		routeFetch(
			(_host, opts) =>
				new Promise((_, reject) => {
					opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
				}),
		);
		const t0 = Date.now();
		const out = await directPrompt(DIRECTOR, 'a rocking chair');
		const ms = Date.now() - t0;
		expect(out).toBeNull();
		expect(ms).toBeGreaterThanOrEqual(1500);
		expect(ms).toBeLessThan(3000);
	}, 10_000);
});

describe('NVIDIA-hosted chat rung', () => {
	it('serves the director when every rung in front of it refuses', async () => {
		const calls = routeFetch((host) => {
			if (host === 'integrate.api.nvidia.com') {
				return new Response(
					JSON.stringify({ choices: [{ message: { content: SPEC } }], usage: { prompt_tokens: 10, completion_tokens: 40 } }),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			}
			return refusalFor(host);
		});
		const run = await directForReference('a rocking chair', { direct: directPrompt });
		expect(run.prompt).toBe(SPEC);
		expect(run.direction).toMatchObject({ status: 'directed' });
		expect(calls).toContain('integrate.api.nvidia.com');
		// It sits BEHIND the existing rungs: Vertex and OpenRouter were asked first.
		expect(calls.indexOf('integrate.api.nvidia.com')).toBeGreaterThan(calls.indexOf('openrouter.ai'));
		expect(calls.findIndex((h) => h.includes('googleapis.com'))).toBe(0);
	});
});
