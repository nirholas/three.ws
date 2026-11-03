/**
 * A batch POST to /api/solana-rpc fans out into one upstream call per entry,
 * so each entry must draw from the per-IP budget (api/evm-rpc.js already does).
 * Charging a ten-entry batch as one request let an anonymous caller burn ten
 * times the keyed upstream quota the limiter is meant to allow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ipCalls = vi.fn();
const state = { ipRemaining: Infinity };
const ok = () => ({ success: true, limit: 120, remaining: 100, reset: Date.now() + 1000 });
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		solanaRpcIp: vi.fn(async () => {
			ipCalls();
			if (state.ipRemaining-- > 0) return ok();
			return { success: false, limit: 120, remaining: 0, reset: Date.now() + 1000 };
		}),
		solanaRpcGlobal: vi.fn(async () => ok()),
	},
	clientIp: () => '203.0.113.9',
}));
const rotate = vi.fn();
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaRpcEndpoints: () => ['https://rpc.example'],
	makeRotatingFetch: () => rotate,
	classifyRpcBody: () => null,
}));

const { default: handler } = await import('../api/solana-rpc.js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null, writableEnded: false, headersSent: false };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? r._b; r.writableEnded = true; };
	return r;
}
const call = async (body) => {
	const res = makeRes();
	await handler(
		{
			method: 'POST',
			url: '/api/solana-rpc',
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '203.0.113.9' },
			body,
		},
		res,
	);
	return res;
};
const entry = (id) => ({ jsonrpc: '2.0', id, method: 'getSlot', params: [] });

beforeEach(() => {
	ipCalls.mockClear();
	rotate.mockReset();
	rotate.mockResolvedValue(new Response('[]', { status: 200 }));
	state.ipRemaining = Infinity;
});

describe('POST /api/solana-rpc batch accounting', () => {
	it('charges the per-IP budget once per batch entry', async () => {
		await call(Array.from({ length: 5 }, (_, i) => entry(i)));
		expect(ipCalls).toHaveBeenCalledTimes(5);
	});

	it('refuses a batch the remaining budget cannot cover before calling upstream', async () => {
		state.ipRemaining = 3;
		const res = await call(Array.from({ length: 5 }, (_, i) => entry(i)));
		expect(res.statusCode).toBe(429);
		expect(rotate).not.toHaveBeenCalled();
	});

	it('charges a single call once', async () => {
		await call(entry(1));
		expect(ipCalls).toHaveBeenCalledTimes(1);
	});
});
