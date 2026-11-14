// The LLM chain's cross-request rung cooldown (api/_lib/llm.js). A rung that is
// out of credit, rejected, or retired gives the same answer for a long while, so
// later completions skip it instead of paying its round trip again; a 429 sits
// out only as long as the provider asks. It must never leave a request with
// nothing to try, and a transient 5xx must never cool a rung at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	llmComplete,
	cooldownMsForStatus,
	llmCooldownSnapshot,
	resetLlmCooldowns,
} from '../../api/_lib/llm.js';

const KEYS = [
	'GROQ_API_KEY',
	'OPENROUTER_API_KEY',
	'OPENROUTER_FALLBACK_KEYS',
	'NVIDIA_API_KEY',
	'NVIDIA_FALLBACK_KEYS',
	'HF_TOKEN',
	'HF_FALLBACK_TOKENS',
	'LLM7_API_KEY',
	'ANTHROPIC_API_KEY',
	'OPENAI_API_KEY',
	'GOOGLE_CLOUD_PROJECT',
];
const saved = {};

const ok = (content) => ({
	ok: true,
	status: 200,
	headers: new Headers(),
	json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
	text: async () => '',
});
const fail = (status, headers = {}) => ({
	ok: false,
	status,
	headers: new Headers(headers),
	json: async () => ({}),
	text: async () => 'upstream said no',
});

// Only Groq (three rungs on one key) plus the two keyless lanes are in the
// chain, which keeps each case's fetch log short and readable.
function onlyGroq() {
	process.env.GROQ_API_KEY = 'g';
}

function routeFetch(handler) {
	const calls = [];
	globalThis.fetch = vi.fn(async (url, opts) => {
		const body = JSON.parse(opts.body);
		const hit = { host: new URL(String(url)).host, model: body.model };
		calls.push(hit);
		return handler(hit);
	});
	return calls;
}

beforeEach(() => {
	for (const k of KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
	resetLlmCooldowns();
});
afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('cooldownMsForStatus', () => {
	it('sits a dead rung out for 30 minutes: no credit, bad key, retired model', () => {
		for (const status of [401, 402, 403, 404, 410]) expect(cooldownMsForStatus(status)).toBe(30 * 60_000);
	});

	it('honors Retry-After on a 429, capped at five minutes, 30s when absent', () => {
		expect(cooldownMsForStatus(429, '12')).toBe(12_000);
		expect(cooldownMsForStatus(429, '86400')).toBe(5 * 60_000);
		expect(cooldownMsForStatus(429, null)).toBe(30_000);
		expect(cooldownMsForStatus(429, 'not-a-number')).toBe(30_000);
	});

	it('never cools on a transient server error', () => {
		for (const status of [500, 502, 503, 504]) expect(cooldownMsForStatus(status)).toBe(0);
	});
});

describe('llmComplete with cooldowns', () => {
	it('skips a rung that 402d on the previous call and goes straight to the next', async () => {
		onlyGroq();
		let calls = routeFetch(({ model }) => (model === 'qwen/qwen3.8-27b' ? fail(402) : ok('from 120b')));
		const first = await llmComplete({ system: 's', user: 'u' });
		expect(first.provider).toBe('groq#120b');
		expect(calls.map((c) => c.model)).toEqual(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b']);

		calls = routeFetch(() => ok('from 120b again'));
		const second = await llmComplete({ system: 's', user: 'u' });
		expect(second.provider).toBe('groq#120b');
		// The out-of-credit rung was not asked again.
		expect(calls.map((c) => c.model)).toEqual(['openai/gpt-oss-120b']);
		expect(llmCooldownSnapshot()).toEqual([
			expect.objectContaining({ rung: 'groq|qwen/qwen3.8-27b', status: 402 }),
		]);
	});

	it('lets a 429 rung back in once its Retry-After has passed', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		onlyGroq();
		routeFetch(({ model }) => (model === 'qwen/qwen3.8-27b' ? fail(429, { 'retry-after': '10' }) : ok('fallback')));
		await llmComplete({ system: 's', user: 'u' });

		vi.setSystemTime(Date.now() + 11_000);
		const calls = routeFetch(() => ok('primary is back'));
		const out = await llmComplete({ system: 's', user: 'u' });
		expect(out.provider).toBe('groq');
		expect(calls[0].model).toBe('qwen/qwen3.8-27b');
	});

	it('does not cool a rung on a 5xx', async () => {
		onlyGroq();
		routeFetch(({ model }) => (model === 'qwen/qwen3.8-27b' ? fail(503) : ok('fallback')));
		await llmComplete({ system: 's', user: 'u' });
		expect(llmCooldownSnapshot()).toEqual([]);
	});

	it('still tries every rung when all of them are cooling, rather than failing unasked', async () => {
		onlyGroq();
		routeFetch(() => fail(402));
		await expect(llmComplete({ system: 's', user: 'u' })).rejects.toMatchObject({ status: 502 });
		expect(llmCooldownSnapshot().length).toBeGreaterThan(0);

		const calls = routeFetch(({ model }) => (model === 'openai-fast' ? ok('keyless lane answered') : fail(402)));
		const out = await llmComplete({ system: 's', user: 'u' });
		expect(out.text).toBe('keyless lane answered');
		expect(calls.length).toBeGreaterThan(1);
	});

	// Production 2026-11-14: four rungs in a row (nvidia:ultra, cloudflare, kilo,
	// ovh) hung to their attempt cap on every /api/seed/synthesize call, spent the
	// whole chain budget, and left the keyless tail that was answering in <1s at
	// budget_exhausted. A stall never cooled, so every retry paid the same ~18s and
	// 502d again. A rung that stalled must sit out the next calls like a 429 does.
	it('sits a stalled rung out so the next call reaches a live lane immediately', async () => {
		onlyGroq();
		const stall = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
		routeFetch(({ model }) => (model === 'qwen/qwen3.8-27b' ? stall() : ok('another lane')));
		// Within the call the stall also skips groq's sibling rungs (host_stalled),
		// so some other host answers; that part is existing behavior.
		const first = await llmComplete({ system: 's', user: 'u' });
		expect(first.text).toBe('another lane');

		const calls = routeFetch(() => ok('from 120b again'));
		const second = await llmComplete({ system: 's', user: 'u' });
		expect(second.provider).toBe('groq#120b');
		expect(calls.map((c) => c.model)).toEqual(['openai/gpt-oss-120b']);
		expect(llmCooldownSnapshot()).toEqual([
			expect.objectContaining({ rung: 'groq|qwen/qwen3.8-27b', status: 'stall' }),
		]);
	});

	it('lets a stalled rung back in after its stall cooldown passes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		onlyGroq();
		const stall = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
		routeFetch(({ model }) => (model === 'qwen/qwen3.8-27b' ? stall() : ok('fallback')));
		await llmComplete({ system: 's', user: 'u' });

		vi.setSystemTime(Date.now() + 2 * 60_000 + 1_000);
		const calls = routeFetch(() => ok('primary is back'));
		const out = await llmComplete({ system: 's', user: 'u' });
		expect(out.provider).toBe('groq');
		expect(calls[0].model).toBe('qwen/qwen3.8-27b');
	});

	it('does not cool a rung on a non-stall transport error', async () => {
		onlyGroq();
		routeFetch(({ model }) => (model === 'qwen/qwen3.8-27b' ? Promise.reject(new TypeError('fetch failed: ECONNRESET')) : ok('fallback')));
		await llmComplete({ system: 's', user: 'u' });
		expect(llmCooldownSnapshot()).toEqual([]);
	});

	it('clears a rung from cooldown the moment it answers again', async () => {
		onlyGroq();
		routeFetch(() => fail(402));
		await expect(llmComplete({ system: 's', user: 'u' })).rejects.toBeTruthy();
		routeFetch(() => ok('recovered'));
		const out = await llmComplete({ system: 's', user: 'u' });
		expect(out.text).toBe('recovered');
		expect(llmCooldownSnapshot().map((c) => c.rung)).not.toContain(`${out.provider}|${out.model}`);
	});
});
