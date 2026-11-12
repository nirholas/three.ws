// The NVIDIA Nemotron lane reasons by default and spends the whole max_tokens
// budget on hidden reasoning, so a 1024-token round came back with empty
// content (measured 2026-11-12: 4090 reasoning chars, 0 content, finish
// "length"). Empty content is skipped by every caller, which silently killed
// learned-skill drafts on that lane. The lane must ask for thinking off.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerChain, streamRound } from '../api/_lib/llm-tool-chain.js';

function sseBody(text) {
	const enc = new TextEncoder();
	const chunks = [
		`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
		'data: [DONE]\n\n',
	];
	return new ReadableStream({
		start(c) {
			for (const ch of chunks) c.enqueue(enc.encode(ch));
			c.close();
		},
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('streamRound reasoning controls', () => {
	it('turns Nemotron thinking off on the nvidia lane so content is returned', async () => {
		vi.stubEnv('NVIDIA_API_KEY', 'k');
		const nvidia = providerChain().find((p) => p.name === 'nvidia');
		expect(nvidia).toBeTruthy();
		const fetchMock = vi.fn(async () => new Response(sseBody('ok'), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const out = await streamRound(nvidia, { messages: [{ role: 'user', content: 'hi' }], tools: [] });
		expect(out.content).toBe('ok');
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
	});

	it('leaves other lanes free of the nvidia-only field', async () => {
		vi.stubEnv('GROQ_API_KEY', 'k');
		const groq = providerChain().find((p) => p.name === 'groq');
		const fetchMock = vi.fn(async () => new Response(sseBody('ok'), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		await streamRound(groq, { messages: [{ role: 'user', content: 'hi' }], tools: [] });
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.chat_template_kwargs).toBeUndefined();
	});
});

describe('completeText', () => {
	it('logs a lane that returns no content and falls through to the next one', async () => {
		const { completeText } = await import('../api/_lib/agent-learning/llm.js');
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(sseBody(''), { status: 200 }))
			.mockResolvedValueOnce(new Response(sseBody('drafted'), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const chain = [
			{ name: 'empty-lane', url: 'https://a.invalid/v1/chat/completions', key: 'k', model: 'm1' },
			{ name: 'good-lane', url: 'https://b.invalid/v1/chat/completions', key: 'k', model: 'm2' },
		];
		const out = await completeText([{ role: 'user', content: 'hi' }], { chain });
		expect(out).toMatchObject({ text: 'drafted', provider: 'good-lane' });
		expect(warn.mock.calls.some((c) => String(c[0]).includes('empty-lane') && /no content/i.test(String(c[0])))).toBe(true);
		warn.mockRestore();
	});
});
