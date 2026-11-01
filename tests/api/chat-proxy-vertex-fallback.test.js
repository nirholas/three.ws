// The built-in chat rides OpenRouter's shared free tier. When that quota is
// exhausted every visitor got "The built-in model is rate-limited" until the
// window reset, even though the platform has Vertex Gemini credits sitting
// idle. The proxy now answers from Vertex when the free lane answers 429 and
// keeps the 429 (with its backoff hint) only when Vertex is unavailable too.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { runAgentCompletion } from '../../api/agent/run.js';

vi.mock('../../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://localhost:3000', OPENROUTER_API_KEY: 'sk-or-test', OPENROUTER_FALLBACK_KEYS: [] },
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { chatIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '203.0.113.7'),
}));

vi.mock('../../api/_lib/openrouter-free.js', () => ({
	isFreeModelId: (id) => typeof id === 'string' && id.endsWith(':free'),
	isLiveFreeModel: async () => true,
	pickDefaultFreeModel: async () => null,
}));

vi.mock('../../api/agent/run.js', () => ({
	AGENT_MODEL_ID: 'three-ws/agent',
	runAgentCompletion: vi.fn(),
}));

const vertex = { available: true };
vi.mock('../../api/_lib/vertex-gemini.js', () => ({
	vertexGeminiAvailable: () => vertex.available,
	vertexGeminiModel: () => 'google/gemini-2.5-flash',
	vertexGeminiChatUrl: () => 'https://vertex.test/chat/completions',
	vertexGeminiHeaders: async () => ({ authorization: 'Bearer gcp-token', 'content-type': 'application/json' }),
	vertexGeminiBudget: (n) => ({ max_tokens: (n || 1024) + 512, extra_body: { google: { thinking_config: { thinking_budget: 512 } } } }),
}));

vi.mock('../../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../api/_lib/zauth.js', () => ({
	instrument: vi.fn(() => null),
	drain: vi.fn(async () => {}),
}));

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

const { default: handler } = await import('../../api/chat/proxy.js');

function makeReq(body) {
	const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
	stream.method = 'POST';
	stream.url = '/api/chat/proxy';
	stream.headers = { host: 'localhost', 'content-type': 'application/json' };
	return stream;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk !== undefined) this.body += String(chunk);
			this.writableEnded = true;
		},
		write(chunk) {
			if (chunk !== undefined) this.body += Buffer.from(chunk).toString();
		},
	};
}

const quota429 = () =>
	new Response(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } }), {
		status: 429,
		headers: { 'content-type': 'application/json' },
	});

const vertexOk = () =>
	new Response('data: {"choices":[{"delta":{"content":"hello from vertex"}}]}\n\ndata: [DONE]\n\n', {
		status: 200,
		headers: { 'content-type': 'text/event-stream' },
	});

const request = { model: 'google/gemma-4-31b-it:free', stream: true, max_tokens: 800, messages: [{ role: 'user', content: 'hi' }] };

beforeEach(() => {
	fetchMock.mockReset();
	runAgentCompletion.mockReset();
	vertex.available = true;
});

describe('POST /api/chat/proxy: Vertex fallback when the free lane is rate-limited', () => {
	it('answers from Vertex Gemini instead of surfacing the 429', async () => {
		fetchMock.mockImplementation(async (url) => (String(url).includes('openrouter.ai') ? quota429() : vertexOk()));
		const res = makeRes();
		await handler(makeReq(request), res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('hello from vertex');
		const vertexCall = fetchMock.mock.calls.find(([u]) => String(u).includes('vertex.test'));
		expect(vertexCall).toBeTruthy();
		expect(vertexCall[1].headers.authorization).toBe('Bearer gcp-token');
		const sent = JSON.parse(vertexCall[1].body);
		expect(sent.model).toBe('google/gemini-2.5-flash');
		expect(sent.messages).toEqual(request.messages);
		expect(sent.stream).toBe(true);
	});

	it('keeps the client tools so the chat app can still call them', async () => {
		fetchMock.mockImplementation(async (url) => (String(url).includes('openrouter.ai') ? quota429() : vertexOk()));
		const tools = [{ type: 'function', function: { name: 'getPrice', parameters: { type: 'object', properties: {} } } }];
		await handler(makeReq({ ...request, tools, tool_choice: 'auto' }), makeRes());
		const sent = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).includes('vertex.test'))[1].body);
		expect(sent.tools).toEqual(tools);
		expect(sent.tool_choice).toBe('auto');
	});

	it('still answers 429 when Vertex is not configured', async () => {
		vertex.available = false;
		fetchMock.mockImplementation(async () => quota429());
		const res = makeRes();
		await handler(makeReq(request), res);
		expect(res.statusCode).toBe(429);
		expect(JSON.parse(res.body).error).toBe('rate_limited');
		expect(fetchMock.mock.calls.some(([u]) => String(u).includes('vertex.test'))).toBe(false);
	});

	it('answers the original 429 when Vertex fails too', async () => {
		fetchMock.mockImplementation(async (url) =>
			String(url).includes('openrouter.ai') ? quota429() : new Response('boom', { status: 500 }),
		);
		const res = makeRes();
		await handler(makeReq(request), res);
		expect(res.statusCode).toBe(429);
		expect(JSON.parse(res.body).error).toBe('rate_limited');
	});

	it('hands the request to the agent loop provider chain when Vertex fails too', async () => {
		fetchMock.mockImplementation(async (url) =>
			String(url).includes('openrouter.ai') ? quota429() : new Response('boom', { status: 500 }),
		);
		runAgentCompletion.mockImplementation(async (_req, res) => {
			res.statusCode = 200;
			res.end('{"choices":[{"message":{"content":"from the loop"}}]}');
		});
		const res = makeRes();
		await handler(makeReq(request), res);
		expect(runAgentCompletion).toHaveBeenCalledTimes(1);
		expect(runAgentCompletion.mock.calls[0][3]).toMatchObject({ rateLimited: true });
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('from the loop');
	});
});
