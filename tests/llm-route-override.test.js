// Per-task evidence routing in api/_lib/llm.js (LLM_ROUTE_<TASK>, see
// docs/evals/grok-4-7-on-three-ws.md): unset leaves every chain exactly as it
// was, a valid value puts the server's Grok key at the head of that task's
// chain only, an invalid value is ignored with one warning, and an xAI error on
// the routed rung falls through to the rest of the chain.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { llmComplete, providerChain, llmRouteOverride, llmRouteEnvKey, grokRouteRung } = await import('../api/_lib/llm.js');
const { GROK_MODELS, GROK_DEFAULT_MODEL, GROK_BUDGET_MODEL, GROK_RETIRED_ALIASES, XAI_CHAT_COMPLETIONS_URL } = await import('../api/_lib/chat-models.js');

const ROUTE_KEYS = ['LLM_ROUTE_FORGE_DIRECTOR', 'LLM_ROUTE_X_REPLY', 'LLM_ROUTE_AGENT_SPEC'];
const TOUCHED = [...ROUTE_KEYS, 'GROK_API_KEY', 'GROQ_API_KEY', 'PHI_WORKER_URL', 'PHI_ROUTED_TASKS', 'VERTEX_CLAUDE_PRIMARY'];
let saved;
let realFetch;
beforeEach(() => {
	saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
	for (const k of TOUCHED) delete process.env[k];
	realFetch = globalThis.fetch;
});
afterEach(() => {
	for (const k of TOUCHED) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

const rungs = (chain) => chain.map((p) => `${p.name}|${p.model}`);
const NON_CHAT = GROK_MODELS.find((m) => !m.chatCompletions).id;
const NO_EFFORTS = GROK_MODELS.find((m) => m.chatCompletions && m.reasoningEfforts.length === 0).id;
const RETIRED = Object.keys(GROK_RETIRED_ALIASES)[0];

describe('llmRouteOverride parsing', () => {
	it('derives the env key from the task tag', () => {
		expect(llmRouteEnvKey('forge_director')).toBe('LLM_ROUTE_FORGE_DIRECTOR');
		expect(llmRouteEnvKey('x-reply')).toBe('LLM_ROUTE_X_REPLY');
	});

	it('is off when unset, empty, off or default', () => {
		for (const value of [undefined, '', '   ', 'off', 'default']) {
			expect(llmRouteOverride('forge_director', { LLM_ROUTE_FORGE_DIRECTOR: value })).toBeNull();
		}
		expect(llmRouteOverride(null, { LLM_ROUTE_NULL: GROK_DEFAULT_MODEL })).toBeNull();
	});

	it('accepts a live chat id with or without a listed reasoning effort', () => {
		expect(llmRouteOverride('forge_director', { LLM_ROUTE_FORGE_DIRECTOR: GROK_DEFAULT_MODEL })).toEqual({ envKey: 'LLM_ROUTE_FORGE_DIRECTOR', model: GROK_DEFAULT_MODEL, effort: null });
		expect(llmRouteOverride('x_reply', { LLM_ROUTE_X_REPLY: ` ${GROK_BUDGET_MODEL}:none ` })).toEqual({ envKey: 'LLM_ROUTE_X_REPLY', model: GROK_BUDGET_MODEL, effort: 'none' });
	});

	it('ignores invalid values with a single warning per value', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const bad = [
			'gpt-4o',
			RETIRED,
			NON_CHAT,
			`${GROK_DEFAULT_MODEL}:none`,
			`${GROK_DEFAULT_MODEL}:turbo`,
			`${NO_EFFORTS}:low`,
			`${GROK_DEFAULT_MODEL}:low:extra`,
			GROK_DEFAULT_MODEL.toUpperCase(),
		];
		for (const value of bad) {
			expect(llmRouteOverride('agent_spec', { LLM_ROUTE_AGENT_SPEC: value }), value).toBeNull();
			expect(llmRouteOverride('agent_spec', { LLM_ROUTE_AGENT_SPEC: value }), value).toBeNull();
		}
		expect(warn).toHaveBeenCalledTimes(bad.length);
		expect(warn.mock.calls[0][0]).toContain('LLM_ROUTE_AGENT_SPEC');
	});
});

describe('providerChain with a route', () => {
	it('leaves the chain unchanged when the flag is off', () => {
		process.env.GROK_API_KEY = 'xai-server';
		process.env.GROQ_API_KEY = 'groq';
		const untagged = rungs(providerChain({}));
		expect(rungs(providerChain({ task: 'forge_director' }))).toEqual(untagged);
		process.env.LLM_ROUTE_FORGE_DIRECTOR = 'off';
		expect(rungs(providerChain({ task: 'forge_director' }))).toEqual(untagged);
	});

	it('puts the routed Grok rung first for that task only, with its effort in the body', () => {
		process.env.GROK_API_KEY = 'xai-server';
		process.env.GROQ_API_KEY = 'groq';
		const before = rungs(providerChain({ task: 'forge_director' }));
		process.env.LLM_ROUTE_FORGE_DIRECTOR = `${GROK_DEFAULT_MODEL}:low`;
		const chain = providerChain({ task: 'forge_director' });
		expect(chain[0]).toMatchObject({ name: 'grok', model: GROK_DEFAULT_MODEL, url: XAI_CHAT_COMPLETIONS_URL });
		expect(chain[0].headers.authorization).toBe('Bearer xai-server');
		expect(chain[0].buildBody('sys', 'hi', 50)).toMatchObject({ model: GROK_DEFAULT_MODEL, reasoning_effort: 'low', max_tokens: 50 });
		expect(rungs(chain.slice(1))).toEqual(before);
		expect(rungs(providerChain({ task: 'x_reply' }))).toEqual(before);
	});

	it('adds nothing without a server Grok key', () => {
		process.env.GROQ_API_KEY = 'groq';
		const before = rungs(providerChain({ task: 'forge_director' }));
		process.env.LLM_ROUTE_FORGE_DIRECTOR = GROK_DEFAULT_MODEL;
		expect(rungs(providerChain({ task: 'forge_director' }))).toEqual(before);
	});

	it('defers to a caller-supplied Grok key instead of stacking a second Grok rung', () => {
		process.env.GROK_API_KEY = 'xai-server';
		process.env.LLM_ROUTE_X_REPLY = `${GROK_BUDGET_MODEL}:none`;
		const chain = providerChain({ task: 'x_reply', grokKey: 'owner-key' });
		expect(chain[0]).toMatchObject({ name: 'grok' });
		expect(chain[0].headers.authorization).toBe('Bearer owner-key');
		expect(chain.slice(1, -1).some((p) => p.headers?.authorization === 'Bearer xai-server')).toBe(false);
	});

	it('builds an xAI rung that omits reasoning_effort when none was named', () => {
		const body = grokRouteRung({ model: GROK_DEFAULT_MODEL }, 'k').buildBody('s', 'u', 10);
		expect(body.model).toBe(GROK_DEFAULT_MODEL);
		expect(body).not.toHaveProperty('reasoning_effort');
	});
});

describe('fall-through on an xAI error', () => {
	const completion = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });

	for (const status of [401, 503]) {
		it(`answers from the next rung when xAI returns ${status}`, async () => {
			process.env.GROK_API_KEY = 'xai-server';
			process.env.GROQ_API_KEY = 'groq';
			process.env.LLM_ROUTE_FORGE_DIRECTOR = `${GROK_DEFAULT_MODEL}:low`;
			const urls = [];
			globalThis.fetch = vi.fn(async (url) => {
				urls.push(String(url));
				if (String(url) === XAI_CHAT_COMPLETIONS_URL) {
					return new Response(JSON.stringify({ error: 'Incorrect API key provided' }), { status, headers: { 'content-type': 'application/json' } });
				}
				return completion('A small red fox, low poly, studio light.');
			});
			const result = await llmComplete({ system: 'Rewrite.', user: 'Idea: fox', maxTokens: 50, task: 'forge_director' });
			expect(urls[0]).toBe(XAI_CHAT_COMPLETIONS_URL);
			expect(result.provider).not.toBe('grok');
			expect(result.text).toBe('A small red fox, low poly, studio light.');
		});
	}

	it('answers from the routed Grok rung when xAI succeeds', async () => {
		process.env.GROK_API_KEY = 'xai-server';
		process.env.LLM_ROUTE_FORGE_DIRECTOR = GROK_DEFAULT_MODEL;
		const bodies = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			if (String(url) === XAI_CHAT_COMPLETIONS_URL) bodies.push(JSON.parse(init.body));
			return completion('ok');
		});
		const result = await llmComplete({ system: 'Rewrite.', user: 'Idea: fox', maxTokens: 50, task: 'forge_director' });
		expect(result).toMatchObject({ provider: 'grok', model: GROK_DEFAULT_MODEL, text: 'ok' });
		expect(bodies[0].model).toBe(GROK_DEFAULT_MODEL);
	});
});
