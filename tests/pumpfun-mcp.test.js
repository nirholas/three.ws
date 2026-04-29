import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/env.js', () => ({
	env: {
		APP_ORIGIN: 'http://test',
		UPSTASH_REDIS_REST_URL: undefined,
		UPSTASH_REDIS_REST_TOKEN: undefined,
	},
}));

const { pumpfunMcp, pumpfunBotEnabled } = await import('../api/_lib/pumpfun-mcp.js');

describe('pumpfun-mcp client', () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		fetchMock.mockReset();
		globalThis.fetch = fetchMock;
		process.env.PUMPFUN_BOT_URL = 'http://bot.test/mcp';
		delete process.env.PUMPFUN_BOT_TOKEN;
	});
	afterEach(() => {
		delete process.env.PUMPFUN_BOT_URL;
		delete process.env.PUMPFUN_BOT_TOKEN;
	});

	it('reports enabled when env URL is set', () => {
		expect(pumpfunBotEnabled()).toBe(true);
	});

	it('reports disabled when URL missing', () => {
		delete process.env.PUMPFUN_BOT_URL;
		expect(pumpfunBotEnabled()).toBe(false);
	});

	it('recentClaims sends jsonrpc tools/call with correct args', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: [{ tx_signature: 'sig1' }] } }),
		});
		const r = await pumpfunMcp.recentClaims({ limit: 5 });
		expect(r.ok).toBe(true);
		expect(r.data).toEqual([{ tx_signature: 'sig1' }]);
		const [, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body.method).toBe('tools/call');
		expect(body.params.name).toBe('getRecentClaims');
		expect(body.params.arguments).toEqual({ limit: 5 });
	});

	it('returns ok:false on non-200 upstream response', async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
		const r = await pumpfunMcp.tokenIntel({ mint: 'abc' });
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/502/);
	});

	it('returns ok:false on rpc error envelope', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } }),
		});
		const r = await pumpfunMcp.graduations({ limit: 3 });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('boom');
	});

	it('rejects tokenIntel without mint', async () => {
		const r = await pumpfunMcp.tokenIntel({});
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/mint/);
	});

	it('attaches bearer token when configured', async () => {
		process.env.PUMPFUN_BOT_TOKEN = 'secret';
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: [] } }),
		});
		await pumpfunMcp.recentClaims();
		const [, init] = fetchMock.mock.calls[0];
		expect(init.headers.authorization).toBe('Bearer secret');
	});
});
