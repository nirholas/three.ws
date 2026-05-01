import { describe, it, expect, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://test', ISSUER: 'http://test', MCP_RESOURCE: 'http://test' },
}));

// Heavy Solana SDK imports not needed for this handler — stub them out.
vi.mock('../api/_lib/pump.js', () => ({}));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => null),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/solana-wallet.js', () => ({}));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: vi.fn() }));
vi.mock('../api/_lib/skill-runtime.js', () => ({ makeRuntime: vi.fn() }));
vi.mock('../api/_lib/agent-spend-policy.js', () => ({}));
vi.mock('../api/payments/_config.js', () => ({
	SOLANA_USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	SOLANA_USDC_MINT_DEVNET: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
	toUsdcAtomics: vi.fn((v) => BigInt(Math.round(v * 1e6))),
}));

const { default: dispatcher } = await import('../api/pump/[action].js');

// ── helpers ────────────────────────────────────────────────────────────────────

function mockReq(search = '') {
	const listeners = {};
	return {
		method: 'GET',
		headers: { host: 'localhost' },
		url: `/api/pump/live-stream${search}`,
		query: { action: 'live-stream' },
		on(event, cb) { listeners[event] = cb; },
		_emit(event) { listeners[event]?.(); },
	};
}

function mockRes() {
	const chunks = [];
	let onWrite = null;
	return {
		statusCode: 200,
		headers: {},
		chunks,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		write(chunk) {
			chunks.push(chunk);
			onWrite?.(chunk);
		},
		end() { this.writableEnded = true; },
		onChunk(fn) { onWrite = fn; },
	};
}

// ── unit: headers and validation ────────────────────────────────────────────────

describe('live-stream SSE headers', () => {
	it('sets correct SSE headers for a GET request', async () => {
		const req = mockReq('?kind=mint');
		const res = mockRes();

		// Don't await — it's a long-lived stream; we'll close it immediately.
		dispatcher(req, res);
		// Give the microtask queue a tick to run the async setup.
		await new Promise((r) => setTimeout(r, 50));

		expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
		expect(res.headers['cache-control']).toBe('no-cache, no-transform');
		expect(res.headers['connection']).toBe('keep-alive');
		expect(res.headers['x-accel-buffering']).toBe('no');
		expect(res.statusCode).toBe(200);

		req._emit('close');
	});

	it('returns 400 for invalid kind param', async () => {
		const req = mockReq('?kind=invalid');
		const res = mockRes();
		await dispatcher(req, res);
		expect(res.statusCode).toBe(400);
	});

	it('accepts kind=all', async () => {
		const req = mockReq('?kind=all');
		const res = mockRes();
		dispatcher(req, res);
		await new Promise((r) => setTimeout(r, 50));
		expect(res.statusCode).toBe(200);
		req._emit('close');
	});

	it('accepts kind=graduation', async () => {
		const req = mockReq('?kind=graduation');
		const res = mockRes();
		dispatcher(req, res);
		await new Promise((r) => setTimeout(r, 50));
		expect(res.statusCode).toBe(200);
		req._emit('close');
	});

	it('defaults to kind=all when kind param is absent', async () => {
		const req = mockReq();
		const res = mockRes();
		dispatcher(req, res);
		await new Promise((r) => setTimeout(r, 50));
		expect(res.statusCode).toBe(200);
		req._emit('close');
	});
});

// ── network: real PumpPortal events ────────────────────────────────────────────

describe('live-stream real network', () => {
	it('receives at least one mint event within 30 s from PumpPortal', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		const req = mockReq('?kind=mint');
		const res = mockRes();

		const firstMint = new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error('no event: mint received within 30 s')),
				30_000,
			);
			res.onChunk((chunk) => {
				if (typeof chunk === 'string' && chunk.startsWith('event: mint')) {
					clearTimeout(timeout);
					resolve(chunk);
				}
			});
		});

		dispatcher(req, res);

		const chunk = await firstMint;
		req._emit('close');

		expect(chunk).toMatch(/^event: mint\ndata: /);
		const json = JSON.parse(chunk.replace(/^event: mint\ndata: /, '').trim());
		expect(json).toHaveProperty('mint');
	}, 35_000);
});
