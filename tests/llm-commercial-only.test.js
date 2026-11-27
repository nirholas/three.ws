// The x402 LLM proxy sells completions for money. Free-tier and trial
// providers (Groq free, OpenRouter :free pools, Kilo, NVIDIA NIM trial, the
// Gemini AI Studio free tier, Mistral Experiment, Pollinations, LLM7, ...)
// forbid or do not license commercial resale, so a paid call must be served
// only by commercially licensed lanes: Vertex AI Gemini, Vertex or first-party
// Claude, and the OpenAI paid API. `commercialOnly` is that explicit switch.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { providerChain, llmComplete } = await import('../api/_lib/llm.js');

const KEYS = [
	'GOOGLE_CLOUD_PROJECT',
	'VERTEX_CLAUDE_ENABLED',
	'VERTEX_CLAUDE_PRIMARY',
	'ANTHROPIC_API_KEY',
	'OPENAI_API_KEY',
	'GROQ_API_KEY',
	'CEREBRAS_API_KEY',
	'SAMBANOVA_API_KEY',
	'MISTRAL_API_KEY',
	'GEMINI_API_KEY',
	'NVIDIA_API_KEY',
	'OPENROUTER_API_KEY',
	'GROK_API_KEY',
	'SILICONFLOW_API_KEY',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

beforeEach(() => {
	for (const k of KEYS) process.env[k] = k === 'VERTEX_CLAUDE_ENABLED' ? 'true' : `test-${k.toLowerCase()}`;
	process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	globalThis.fetch = realFetch;
});

const names = (chain) => chain.map((p) => p.name);
const COMMERCIAL = ['vertex-gemini', 'vertex-anthropic', 'anthropic', 'openai'];

describe('providerChain commercialOnly', () => {
	it('contains only commercially licensed lanes even with every free key configured', () => {
		const chain = providerChain({ commercialOnly: true });
		expect(chain.length).toBeGreaterThan(0);
		for (const n of names(chain)) expect(COMMERCIAL).toContain(n);
		for (const p of chain) {
			expect(p.model).not.toMatch(/:free$/);
			expect(p.url).not.toMatch(/kilo\.ai|openrouter|integrate\.api\.nvidia|generativelanguage|mistral|pollinations|llm7|groq|cerebras|sambanova/);
		}
	});

	it('leads with Vertex Gemini, then Claude, then OpenAI', () => {
		expect(names(providerChain({ commercialOnly: true }))).toEqual([
			'vertex-gemini',
			'vertex-anthropic',
			'anthropic',
			'openai',
		]);
	});

	it('leads with Claude when the caller asks for a Claude model', () => {
		const order = names(providerChain({ commercialOnly: true, anthropicModel: 'claude-haiku-4-5-20251001' }));
		expect(order[0]).toBe('vertex-anthropic');
		expect(order).toContain('vertex-gemini');
		expect(order.indexOf('anthropic')).toBeLessThan(order.indexOf('openai'));
	});

	it('drops lanes whose credentials are absent instead of falling back to a free one', () => {
		delete process.env.GOOGLE_CLOUD_PROJECT;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPENAI_API_KEY;
		expect(providerChain({ commercialOnly: true })).toEqual([]);
	});

	it('leaves the default chain unchanged for every other caller', () => {
		const def = names(providerChain({}));
		expect(def).toContain('groq');
		expect(def).toContain('gemini');
		expect(def).toContain('vertex-gemini');
	});
});

describe('llmComplete commercialOnly', () => {
	it('never contacts a free lane and filters a caller-supplied chain too', async () => {
		const hosts = [];
		globalThis.fetch = vi.fn(async (url) => {
			hosts.push(new URL(url).host);
			return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		const free = {
			name: 'groq',
			model: 'm',
			url: 'https://api.groq.com/openai/v1/chat/completions',
			headers: {},
			buildBody: () => ({}),
			extractText: (r) => r.choices?.[0]?.message?.content || '',
			extractUsage: () => ({ input: 0, output: 0 }),
		};
		const paid = { ...free, name: 'openai', url: 'https://api.openai.com/v1/chat/completions' };
		const out = await llmComplete({ system: 's', user: 'u', commercialOnly: true, chain: [free, paid] });
		expect(out.provider).toBe('openai');
		expect(hosts).toEqual(['api.openai.com']);
	});

	it('throws LlmUnavailableError rather than serving from a free lane when nothing commercial is configured', async () => {
		delete process.env.GOOGLE_CLOUD_PROJECT;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPENAI_API_KEY;
		globalThis.fetch = vi.fn();
		await expect(llmComplete({ system: 's', user: 'u', commercialOnly: true })).rejects.toThrow();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
