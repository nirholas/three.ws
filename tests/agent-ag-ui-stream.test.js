import { describe, it, expect, vi, beforeEach } from 'vitest';

// The loop's impure edges are all mocked at module boundaries: the LLM chain
// (scripted rounds), the tool registry (a spy handler), the rate limiter, and
// env. What runs for real is the AgentRuntime loop, the GuardChain preflight,
// and the OpenAI wire formatting.
const agentRunIp = vi.fn();
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { agentRunIp: (...a) => agentRunIp(...a) },
	clientIp: () => '1.2.3.4',
}));
vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://localhost:3000', ISSUER: 'http://t', MCP_RESOURCE: 'http://t' },
}));

const providerChain = vi.fn();
const streamRound = vi.fn();
vi.mock('../api/_lib/llm-tool-chain.js', () => ({
	providerChain: (...a) => providerChain(...a),
	streamRound: (...a) => streamRound(...a),
}));

const priceHandler = vi.fn();
vi.mock('../api/_lib/agent-tools.js', () => ({
	agentToolSchemas: () => [
		{
			type: 'function',
			function: {
				name: 'token_price',
				description: 'test tool',
				parameters: { type: 'object', properties: { query: { type: 'string' } } },
			},
		},
	],
	agentToolHandlers: () => ({ token_price: (...a) => priceHandler(...a) }),
}));
// The sandbox tools are offered only to a signed-in agent owner; these
// requests are anonymous, so the module's real credit/plan imports stay out.
vi.mock('../api/_lib/sandbox/toolset.js', () => ({
	sandboxToolset: () => ({ schemas: [], handlers: {}, note: '', names: [] }),
}));

const { default: runHandler } = await import('../api/agent/run.js');

function mkReq({ method = 'POST', body = null } = {}) {
	return {
		method,
		url: '/api/agent/run',
		headers: body != null ? { 'content-type': 'application/json' } : {},
		socket: { remoteAddress: '127.0.0.1' },
		on(event, cb) {
			if (event === 'data' && body != null) {
				queueMicrotask(() => {
					cb(Buffer.from(JSON.stringify(body)));
					this._endCb?.();
				});
			} else if (event === 'end') {
				if (body == null) queueMicrotask(() => cb());
				else this._endCb = cb;
			}
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		chunks: [],
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		write(c) {
			this.chunks.push(String(c));
		},
		end(c) {
			if (c != null) this.chunks.push(String(c));
			this.writableEnded = true;
		},
	};
}
const sseText = (res) => res.chunks.join('');

beforeEach(() => {
	agentRunIp.mockReset().mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: Date.now() + 1000 });
	providerChain.mockReset().mockReturnValue([{ name: 'scripted', url: 'http://test', key: 'k', model: 'm' }]);
	streamRound.mockReset();
	priceHandler.mockReset();
});


const events = (res) =>
	sseText(res)
		.split('\n\n')
		.filter((f) => f.startsWith('data: '))
		.map((f) => JSON.parse(f.slice(6)));
const types = (res) => events(res).map((e) => e.type);
const agUiReq = (body, url = '/api/agent/run?protocol=ag-ui') => ({ ...mkReq({ body }), url });

describe('POST /api/agent/run?protocol=ag-ui', () => {
	it('emits the documented event sequence for a run with a tool call', async () => {
		streamRound
			.mockImplementationOnce(async (_p, { onContent }) => {
				onContent('Let me check. ');
				return { content: 'Let me check. ', toolCalls: [{ id: 'c1', name: 'token_price', args: '{"query":"solana"}' }] };
			})
			.mockImplementationOnce(async (_p, { onContent }) => {
				onContent('SOL is ');
				onContent('$200.');
				return { content: 'SOL is $200.', toolCalls: [] };
			});
		priceHandler.mockResolvedValue({ found: true, priceUsd: 200 });

		const res = mkRes();
		await runHandler(agUiReq({ threadId: 't1', runId: 'r1', messages: [{ id: 'm1', role: 'user', content: 'price of sol?' }] }), res);

		expect(res.headers['content-type']).toContain('text/event-stream');
		const seq = types(res).filter((t) => t !== 'CUSTOM');
		expect(seq).toEqual([
			'RUN_STARTED',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'TOOL_CALL_START',
			'TOOL_CALL_ARGS',
			'TOOL_CALL_END',
			'TOOL_CALL_RESULT',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'RUN_FINISHED',
		]);
		const evs = events(res);
		expect(evs[0]).toMatchObject({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1', protocolVersion: '1.0' });
		const start = evs.find((e) => e.type === 'TOOL_CALL_START');
		expect(start).toMatchObject({ toolCallId: 'c1', toolCallName: 'token_price' });
		expect(JSON.parse(evs.find((e) => e.type === 'TOOL_CALL_ARGS').delta)).toEqual({ query: 'solana' });
		const result = evs.find((e) => e.type === 'TOOL_CALL_RESULT');
		expect(result).toMatchObject({ toolCallId: 'c1', role: 'tool' });
		expect(JSON.parse(result.content)).toMatchObject({ priceUsd: 200 });
		const texts = evs.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta);
		expect(texts).toEqual(['Let me check. ', 'SOL is ', '$200.']);
		// Each text message start/end pair shares one id; the two messages differ.
		const ids = evs.filter((e) => e.type === 'TEXT_MESSAGE_START').map((e) => e.messageId);
		expect(new Set(ids).size).toBe(2);
		expect(evs.at(-1)).toMatchObject({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' });
		expect(sseText(res)).not.toContain('[DONE]');
		expect(priceHandler).toHaveBeenCalledWith({ query: 'solana' });
	});

	it('negotiates from the AG-UI Accept header and ignores the stream flag', async () => {
		streamRound.mockImplementationOnce(async (_p, { onContent }) => {
			onContent('hi');
			return { content: 'hi', toolCalls: [] };
		});
		const req = { ...mkReq({ body: { messages: [{ role: 'user', content: 'hi' }], stream: false } }), headers: { 'content-type': 'application/json', accept: 'application/vnd.ag-ui.event+stream' } };
		const res = mkRes();
		await runHandler(req, res);
		expect(types(res)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
	});

	it('emits embodiment CUSTOM events: think on a tool call, concern when a tool fails', async () => {
		streamRound
			.mockImplementationOnce(async () => ({ content: '', toolCalls: [{ id: 'c1', name: 'token_price', args: '{}' }] }))
			.mockImplementationOnce(async () => ({ content: 'Sorry.', toolCalls: [] }));
		priceHandler.mockRejectedValue(new Error('upstream down'));

		const res = mkRes();
		await runHandler(agUiReq({ messages: [{ role: 'user', content: 'x' }] }), res);

		const custom = events(res).filter((e) => e.type === 'CUSTOM');
		expect(custom.every((e) => e.name === 'three.ws.embodiment')).toBe(true);
		expect(custom.map((e) => e.value)).toEqual([
			{ type: 'think', phase: 'tool', tool: 'token_price' },
			{ type: 'emote', emotion: 'concern', reason: 'tool_error', tool: 'token_price' },
		]);
		const result = events(res).find((e) => e.type === 'TOOL_CALL_RESULT');
		expect(JSON.parse(result.content).error).toContain('upstream down');
	});

	it('a blocked tool emits a concern cue and no tool-call events', async () => {
		streamRound
			.mockImplementationOnce(async () => ({ content: '', toolCalls: [{ id: 'c9', name: 'not_a_tool', args: '{}' }] }))
			.mockImplementationOnce(async () => ({ content: 'No such tool.', toolCalls: [] }));
		const res = mkRes();
		await runHandler(agUiReq({ messages: [{ role: 'user', content: 'x' }] }), res);
		expect(types(res)).not.toContain('TOOL_CALL_START');
		expect(events(res).find((e) => e.type === 'CUSTOM').value).toMatchObject({ type: 'emote', emotion: 'concern', reason: 'tool_blocked' });
		expect(types(res).at(-1)).toBe('RUN_FINISHED');
	});

	it('answers a failed run with RUN_ERROR after RUN_STARTED, closing any open text', async () => {
		streamRound.mockImplementationOnce(async (_p, { onContent }) => {
			onContent('partial');
			throw new Error('lane exploded');
		});
		const res = mkRes();
		await runHandler(agUiReq({ messages: [{ role: 'user', content: 'x' }] }), res);
		const seq = types(res);
		expect(seq[0]).toBe('RUN_STARTED');
		expect(seq.at(-1)).toBe('RUN_ERROR');
		expect(seq).not.toContain('RUN_FINISHED');
		const err = events(res).at(-1);
		expect(err.message).toContain('lane exploded');
		expect(err.code).toBe('agent_loop_failed');
		if (seq.includes('TEXT_MESSAGE_START')) expect(seq.indexOf('TEXT_MESSAGE_END')).toBeGreaterThan(seq.indexOf('TEXT_MESSAGE_START'));
	});

	it('flattens text-part content from RunAgentInput', async () => {
		streamRound.mockImplementationOnce(async () => ({ content: 'ok', toolCalls: [] }));
		const res = mkRes();
		await runHandler(agUiReq({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hel' }, { type: 'text', text: 'lo' }] }] }), res);
		const sent = streamRound.mock.calls[0][1].messages;
		expect(sent.find((m) => m.role === 'user').content).toBe('hello');
	});

	it('reads the agent from forwardedProps.agent_id and rejects a bad id before streaming', async () => {
		const res = mkRes();
		await runHandler(agUiReq({ messages: [{ role: 'user', content: 'x' }], forwardedProps: { agent_id: 'not-a-uuid' } }), res);
		expect(res.statusCode).toBe(400);
		expect(sseText(res)).toContain('bad_agent_id');
		expect(streamRound).not.toHaveBeenCalled();
	});

	it('leaves the default stream untouched without the protocol flag', async () => {
		streamRound.mockImplementationOnce(async (_p, { onContent }) => {
			onContent('plain');
			return { content: 'plain', toolCalls: [] };
		});
		const res = mkRes();
		await runHandler(mkReq({ body: { messages: [{ role: 'user', content: 'hi' }], stream: true } }), res);
		const text = sseText(res);
		expect(text).toContain('chat.completion.chunk');
		expect(text).toContain('data: [DONE]');
		expect(text).not.toContain('RUN_STARTED');
	});
});
