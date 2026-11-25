// The LLM chain skips the remaining rungs on a host once one of them stalls
// (api/_lib/llm.js, stalledHosts). That guard was written for OpenRouter, where
// three rungs carried the SAME model on different keys and a hung host hung all
// of them. It was keyed by host alone, so it also skipped rungs that run a
// DIFFERENT model on that host. In production on 2026-11-25 NVIDIA's 550B Ultra
// rung was cut off by its fair-share slice, and the 30B Lightning rung on the
// same NIM host, which answers in about 0.35s, was reported `host_stalled` and
// never asked. Kilo's Super rung was dropped behind Kilo's Ultra the same way.
// A slow model is a property of that model, not of every model behind the host.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { llmComplete } = await import('../api/_lib/llm.js');

function rung(name, url, model) {
	return {
		name,
		model,
		url,
		headers: { 'content-type': 'application/json' },
		buildBody: (system, user, maxTokens) => ({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] }),
		extractText: (r) => r.choices?.[0]?.message?.content || '',
		extractUsage: () => ({ input: 0, output: 0 }),
	};
}

const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const answer = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function mockFetch(behaviour) {
	const asked = [];
	globalThis.fetch = vi.fn(async (url, init) => {
		const { model } = JSON.parse(init.body);
		asked.push(`${new URL(url).host}|${model}`);
		return behaviour(new URL(url).host, model);
	});
	return asked;
}

const NIM = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const OTHER = 'https://api.example-lane.test/v1/chat/completions';

describe('a stall on one rung of a shared host', () => {
	it('still asks a sibling rung that runs a different model on that host', async () => {
		const asked = mockFetch((host, model) => {
			if (model === 'nvidia/ultra') throw timeout();
			return answer(`from ${model}`);
		});
		const out = await llmComplete({
			user: 'hi',
			chain: [rung('nvidia', NIM, 'nvidia/ultra'), rung('nvidia:lightning', NIM, 'nvidia/lightning'), rung('other', OTHER, 'other/model')],
		});
		expect(out.provider).toBe('nvidia:lightning');
		expect(asked).toEqual(['integrate.api.nvidia.com|nvidia/ultra', 'integrate.api.nvidia.com|nvidia/lightning']);
	});

	it('skips a sibling that runs the same model on that host behind another key', async () => {
		const asked = mockFetch((host, model) => {
			if (host === 'openrouter.ai') throw timeout();
			return answer('from the next host');
		});
		const err = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = await llmComplete({
			user: 'hi',
			chain: [rung('openrouter', OPENROUTER, 'm/free'), rung('openrouter#2', OPENROUTER, 'm/free'), rung('other', OTHER, 'other/model')],
		});
		err.mockRestore();
		expect(out.provider).toBe('other');
		expect(asked).toEqual(['openrouter.ai|m/free', 'api.example-lane.test|other/model']);
	});
});
