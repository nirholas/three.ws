import { describe, it, expect } from 'vitest';
import { chatCompletionsRung, isRetryable } from '../api/_lib/x-content/llm.js';

const request = { system: 'Return JSON.', parts: [{ type: 'text', text: 'Review this.' }] };
const rung = { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: 'k', model: 'moonshotai/kimi-k3', label: 'nvidia', retryMs: 0 };
const ok = (text) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }), text: async () => '' });
const fail = (status, text) => ({ ok: false, status, json: async () => ({}), text: async () => text });

function scripted(...steps) {
	const calls = [];
	return {
		calls,
		fetchImpl: async (url, init) => {
			calls.push(init);
			const step = steps[calls.length - 1];
			if (step instanceof Error) throw step;
			return step;
		},
	};
}

describe('which failures a rung tries again', () => {
	it('retries a dropped connection, a 5xx and a plain rate limit', () => {
		expect(isRetryable({ networkError: true })).toBe(true);
		expect(isRetryable({ status: 502 })).toBe(true);
		expect(isRetryable({ status: 429, body: 'Too Many Requests' })).toBe(true);
	});

	it('falls through at once on a refusal about billing or credentials', () => {
		expect(isRetryable({ status: 429, body: 'Your account is not active, please check your billing details' })).toBe(false);
		expect(isRetryable({ status: 402, body: 'Insufficient credits' })).toBe(false);
		expect(isRetryable({ status: 403, body: 'insufficient authentication scopes' })).toBe(false);
		expect(isRetryable({ status: 400, body: 'bad request' })).toBe(false);
	});
});

describe('a chat-completions rung', () => {
	it('answers after a dropped connection and a 503', async () => {
		const { calls, fetchImpl } = scripted(new TypeError('fetch failed'), fail(503, 'unavailable'), ok('{"verdict":"publish"}'));
		const result = await chatCompletionsRung(request, { ...rung, fetchImpl });
		expect(result).toEqual({ model: 'nvidia:moonshotai/kimi-k3', text: '{"verdict":"publish"}' });
		expect(calls).toHaveLength(3);
		expect(calls[0].body).toBe(calls[2].body);
	});

	it('gives up after its last try and says how many it took', async () => {
		const { calls, fetchImpl } = scripted(new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed'));
		await expect(chatCompletionsRung(request, { ...rung, fetchImpl })).rejects.toThrow('nvidia fetch failed (after 3 tries)');
		expect(calls).toHaveLength(3);
	});

	it('does not repeat a billing refusal', async () => {
		const { calls, fetchImpl } = scripted(fail(429, 'Your account is not active, please check your billing details'));
		await expect(chatCompletionsRung(request, { ...rung, fetchImpl })).rejects.toThrow('nvidia 429: Your account is not active');
		expect(calls).toHaveLength(1);
	});

	it('skips a text-only rung for a request that carries an image, and a rung with no key', async () => {
		const withImage = { system: 's', parts: [{ type: 'image', mime: 'image/jpeg', data: 'AA' }] };
		expect(await chatCompletionsRung(withImage, { ...rung, textOnly: true, fetchImpl: async () => ok('x') })).toBe(null);
		expect(await chatCompletionsRung(request, { ...rung, key: '', fetchImpl: async () => ok('x') })).toBe(null);
	});
});
