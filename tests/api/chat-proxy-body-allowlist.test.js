// OpenRouter answers a free-tier quota cap with 429 and NO Retry-After header:
// the reset instant lives inside the error body, at
// error.metadata.headers['X-RateLimit-Reset'] (epoch milliseconds). The proxy
// used to look only at headers, so a quota-exhausted response reached the
// browser with no backoff hint at all and clients could only guess or spin.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://localhost:3000', OPENROUTER_API_KEY: 'sk-or-test', OPENROUTER_FALLBACK_KEYS: [] },
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { chatIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '203.0.113.7'),
}));

// The model gate and liveness check are covered by chat-proxy-ratelimit.test.js;
// here they must simply let a valid :free id through to the upstream call.
vi.mock('../../api/_lib/openrouter-free.js', () => ({
	isFreeModelId: (id) => typeof id === 'string' && id.endsWith(':free'),
	isLiveFreeModel: async () => true,
	pickDefaultFreeModel: async () => null,
}));

vi.mock('../../api/agent/run.js', () => ({
	AGENT_MODEL_ID: 'three-ws/agent',
	runAgentCompletion: vi.fn(),
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
			if (chunk !== undefined) this.body += String(chunk);
		},
	};
}

/** A 429 shaped exactly like OpenRouter's real quota-cap response. */
function quotaCapped(resetEpochMs, { retryAfterHeader = null } = {}) {
	return {
		status: 429,
		body: null,
		headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? retryAfterHeader : null) },
		text: async () =>
			JSON.stringify({
				error: {
					message: 'Rate limit exceeded: free-models-per-day-high-balance. ',
					code: 429,
					metadata: {
						headers: {
							'X-RateLimit-Limit': '1000',
							'X-RateLimit-Remaining': '0',
							'X-RateLimit-Reset': String(resetEpochMs),
						},
					},
				},
			}),
	};
}

beforeEach(() => {
	fetchMock.mockReset();
});

describe('POST /api/chat/proxy: upstream body allowlist', () => {
	it('drops routing, plugin and fallback-model fields and clamps max_tokens', async () => {
		fetchMock.mockResolvedValue({
			status: 200,
			body: null,
			headers: { get: () => 'application/json' },
			text: async () => '{}',
		});
		const res = makeRes();
		await handler(
			makeReq({
				model: 'x/y:free',
				messages: [{ role: 'user', content: 'hi' }],
				stream: true,
				temperature: 0.5,
				models: ['openai/gpt-4o'],
				plugins: [{ id: 'web' }],
				provider: { order: ['openai'] },
				route: 'fallback',
				transforms: ['middle-out'],
				max_tokens: 10_000_000,
			}),
			res,
		);
		const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(sent.model).toBe('x/y:free');
		expect(sent.stream).toBe(true);
		expect(sent.temperature).toBe(0.5);
		expect(sent.messages).toHaveLength(1);
		for (const k of ['models', 'plugins', 'provider', 'route', 'transforms']) {
			expect(sent).not.toHaveProperty(k);
		}
		expect(sent.max_tokens).toBeLessThanOrEqual(16384);
	});
});
