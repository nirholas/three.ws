// api/_lib/xai-conv-id.js and its use on the llm.js chain: requests of one
// conversation (or one task) carry the same x-grok-conv-id so xAI's per-server
// prompt cache hits, and no other provider ever sees the header.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { grokConvId, withGrokConvId, XAI_CONV_ID_HEADER } = await import('../api/_lib/xai-conv-id.js');
const { llmComplete, grokRouteRung } = await import('../api/_lib/llm.js');
const { XAI_CHAT_COMPLETIONS_URL } = await import('../api/_lib/chat-models.js');

describe('grokConvId', () => {
	it('is stable for the same parts and differs when any part changes', () => {
		const a = grokConvId('chat', 'agent-1', 'hello');
		expect(a).toBe(grokConvId('chat', 'agent-1', 'hello'));
		expect(a).toMatch(/^tws-[0-9a-f]{32}$/);
		expect(grokConvId('chat', 'agent-2', 'hello')).not.toBe(a);
		expect(grokConvId('chat', 'agent-1', 'hello again')).not.toBe(a);
	});

	it('hashes structured content (vision messages) and never leaks it', () => {
		const parts = [{ type: 'text', text: 'my secret' }, { type: 'image_url', image_url: { url: 'data:x' } }];
		const id = grokConvId('chat', null, parts);
		expect(id).toBe(grokConvId('chat', null, parts));
		expect(id).not.toContain('secret');
	});

	it('only adds the header for api.x.ai', () => {
		const base = { authorization: 'Bearer k' };
		expect(withGrokConvId(XAI_CHAT_COMPLETIONS_URL, base, 'x')[XAI_CONV_ID_HEADER]).toBe(grokConvId('x'));
		expect(withGrokConvId('https://api.groq.com/openai/v1/chat/completions', base, 'x')).toBe(base);
		expect(withGrokConvId('not a url', base, 'x')).toBe(base);
		expect(base[XAI_CONV_ID_HEADER]).toBeUndefined();
	});
});

describe('llmComplete on the Grok rung', () => {
	let realFetch;
	beforeEach(() => {
		realFetch = globalThis.fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('sends one conv id per task and system prompt, and the same id on every call', async () => {
		const seen = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			seen.push({ url, headers: init.headers });
			return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		const chain = [grokRouteRung({ model: 'grok-4.3' }, 'xai-test')];
		await llmComplete({ system: 'You write tweets.', user: 'one', task: 'x_reply', chain });
		await llmComplete({ system: 'You write tweets.', user: 'two', task: 'x_reply', chain });
		await llmComplete({ system: 'You grade answers.', user: 'one', task: 'grader', chain });
		const ids = seen.map((s) => s.headers[XAI_CONV_ID_HEADER]);
		expect(seen.every((s) => s.url === XAI_CHAT_COMPLETIONS_URL)).toBe(true);
		expect(ids[0]).toBe(grokConvId('task', 'x_reply', 'You write tweets.'));
		expect(ids[1]).toBe(ids[0]);
		expect(ids[2]).not.toBe(ids[0]);
	});
});
