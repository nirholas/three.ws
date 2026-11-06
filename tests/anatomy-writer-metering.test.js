// The anatomy writer booked every completion with no cost, so all of its spend,
// the paid Anthropic and OpenRouter rungs included, reached the ledger as UNKNOWN
// and failed audit:llm-metering. Free rungs must book 0, paid rungs a real price.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/usage.js', async (importOriginal) => ({
	...(await importOriginal()),
	recordEvent,
}));

import { streamSpec } from '../api/_lib/anatomy/writer.js';

const sse = (lines) => new Response(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join(''), { status: 200 });

const chatReply = () => sse([
	{ choices: [{ delta: { content: '{"name":"pump"}' } }] },
	{ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 2000 } },
]);

const anthropicReply = () => sse([
	{ type: 'message_start', message: { usage: { input_tokens: 1000 } } },
	{ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"name":"pump"}' } },
	{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2000 } },
]);

const write = (env, reply) => streamSpec({
	system: 's',
	messages: [{ role: 'user', content: 'pump' }],
	env,
	fetchImpl: async () => reply(),
});

describe('anatomy writer metering', () => {
	beforeEach(() => recordEvent.mockClear());

	it('books a free NVIDIA rung at exactly zero, not unknown', async () => {
		await write({ NVIDIA_API_KEY: 'k' }, chatReply);
		expect(recordEvent).toHaveBeenCalledTimes(1);
		expect(recordEvent.mock.calls[0][0]).toMatchObject({ provider: 'nvidia', costMicroUsd: 0 });
	});

	it('books a paid Anthropic rung at a real price', async () => {
		await write({ ANTHROPIC_API_KEY: 'k' }, anthropicReply);
		expect(recordEvent.mock.calls[0][0].provider).toBe('anthropic');
		expect(recordEvent.mock.calls[0][0].costMicroUsd).toBeGreaterThan(0);
	});
});
