import { afterEach, describe, expect, it } from 'vitest';
import { ThreeAgents } from '../src/index.ts';
import { backoffMs, readRateLimit, readRetryAfter } from '../src/transport.ts';
import { startServer, json } from './_helpers/server.js';

let srv;
afterEach(async () => { await srv?.close(); srv = null; });
const client = (extra = {}) => new ThreeAgents({ apiKey: 'sk_live_test', baseUrl: srv.baseUrl, retryDelay: 1, ...extra });

describe('transport', () => {
	it('sends bearer auth, accept and a user agent, and unwraps the data envelope', async () => {
		srv = await startServer((req, res) => json(res, 200, { data: { id: 'a1', name: 'x' }, meta: { requestId: 'r1' } }));
		const agent = await client().getAgent('a1');
		expect(agent).toEqual({ id: 'a1', name: 'x' });
		const h = srv.seen[0].headers;
		expect(h.authorization).toBe('Bearer sk_live_test');
		expect(h.accept).toBe('application/json');
		expect(h['user-agent']).toMatch(/^@three-ws\/agents\//);
		expect(h['idempotency-key']).toBeUndefined();
	});

	it('retries 5xx with the same idempotency key on a write and then succeeds', async () => {
		srv = await startServer((req, res, n) =>
			n < 3 ? json(res, 503, { error: { code: 'unavailable', message: 'busy' } }) : json(res, 200, { data: { agent: { id: 'n1' } } }));
		const agent = await client().createAgent({ name: 'n' });
		expect(agent.id).toBe('n1');
		expect(srv.seen).toHaveLength(3);
		const keys = new Set(srv.seen.map((r) => r.headers['idempotency-key']));
		expect(keys.size).toBe(1);
		expect([...keys][0]).toBeTruthy();
	});

	it('uses a caller supplied idempotency key verbatim', async () => {
		srv = await startServer((req, res) => json(res, 200, { data: { agent: { id: 'n1' } } }));
		await client().createAgent({ name: 'n' }, { idempotencyKey: 'my-key-1' });
		expect(srv.seen[0].headers['idempotency-key']).toBe('my-key-1');
	});

	it('does not retry a 4xx', async () => {
		srv = await startServer((req, res) => json(res, 404, { error: { code: 'not_found', message: 'nope' } }));
		await expect(client().getAgent('a1')).rejects.toMatchObject({ name: 'NotFoundError', status: 404 });
		expect(srv.seen).toHaveLength(1);
	});

	it('stops after the configured retries and throws ServerError', async () => {
		srv = await startServer((req, res) => json(res, 500, { error: { code: 'boom', message: 'x' } }));
		await expect(client({ retries: 1 }).getAgent('a1')).rejects.toMatchObject({ name: 'ServerError', status: 500 });
		expect(srv.seen).toHaveLength(2);
	});

	it('retries a 409 idempotency_in_progress', async () => {
		srv = await startServer((req, res, n) =>
			n < 2 ? json(res, 409, { error: { code: 'idempotency_in_progress', message: 'wait' } }) : json(res, 200, { data: { agent: { id: 'z' } } }));
		expect((await client().createAgent({ name: 'n' })).id).toBe('z');
		expect(srv.seen).toHaveLength(2);
	});

	it('times out and reports TimeoutError', async () => {
		srv = await startServer(() => {});
		await expect(client({ timeout: 40, retries: 0 }).getAgent('a1')).rejects.toMatchObject({ name: 'TimeoutError' });
	});

	it('reports ConnectionError when nothing is listening', async () => {
		srv = await startServer((req, res) => json(res, 200, {}));
		const dead = srv.baseUrl;
		await srv.close();
		srv = null;
		const c = new ThreeAgents({ apiKey: 'k', baseUrl: dead, retries: 0 });
		await expect(c.getAgent('a1')).rejects.toMatchObject({ name: 'ConnectionError' });
	});

	it('surfaces rate-limit headers and Retry-After on a 429', async () => {
		srv = await startServer((req, res) =>
			json(res, 429, { error: { code: 'rate_limited', message: 'slow' } }, { 'ratelimit-limit': '60', 'ratelimit-remaining': '0', 'ratelimit-reset': '12', 'retry-after': '7' }));
		const err = await client().getAgent('a1').catch((e) => e);
		expect(err.name).toBe('RateLimitError');
		expect(err.retryAfter).toBe(7);
		expect(err.rateLimit).toEqual({ limit: 60, remaining: 0, reset: 12 });
		expect(srv.seen).toHaveLength(1);
	});

	it('reads pagination meta into a Page', async () => {
		srv = await startServer((req, res) => json(res, 200, { data: [{ id: 'a' }], meta: { hasMore: true, nextCursor: 'c2', requestId: 'r9' } }));
		const page = await client().listAgents({ limit: 1 });
		expect(page).toMatchObject({ hasMore: true, nextCursor: 'c2', requestId: 'r9' });
		expect(srv.seen[0].query).toEqual({ limit: '1' });
	});

	it('reads the legacy error envelope', async () => {
		srv = await startServer((req, res) => json(res, 401, { error: 'unauthorized', error_description: 'bad key' }));
		await expect(client().getAgent('a1')).rejects.toMatchObject({ name: 'AuthenticationError', message: 'bad key' });
	});
});

describe('transport helpers', () => {
	it('backoff doubles per attempt with at most 20% jitter', () => {
		for (let a = 0; a < 4; a++) {
			const v = backoffMs(100, a);
			expect(v).toBeGreaterThanOrEqual(100 * 2 ** a);
			expect(v).toBeLessThanOrEqual(120 * 2 ** a);
		}
	});
	it('parses both rate-limit header spellings', () => {
		expect(readRateLimit(new Headers({ 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '4' }))).toEqual({ limit: 5, remaining: 4, reset: null });
		expect(readRateLimit(new Headers())).toBeNull();
	});
	it('parses Retry-After as seconds and as an HTTP date', () => {
		expect(readRetryAfter(new Headers({ 'retry-after': '3' }))).toBe(3);
		const at = new Date(Date.now() + 5000).toUTCString();
		expect(readRetryAfter(new Headers({ 'retry-after': at }))).toBeGreaterThanOrEqual(3);
		expect(readRetryAfter(new Headers())).toBeNull();
	});
});
