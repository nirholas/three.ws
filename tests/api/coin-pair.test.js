// /api/coin/pair: the pool-address -> token bridge, and its status contract.
//
// This route exists so a surface that names a market by its PAIR address (every
// DEX terminal does) can address a three.ws scene. The status mapping is the
// whole contract for an embed: a pair nothing has indexed is a 404 the embed
// renders as "we can't draw this market yet", a throttle is a 429 it retries,
// and anything else is a 502. An embed that got a 500 would sit on a dead frame
// inside somebody else's page, which is the failure this pins shut.
//
// The validation cases matter for the same reason: the address arrives from a
// third-party page's URL, so a malformed one is rejected at the boundary and
// never reaches upstream.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { marketDataIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.1',
}));

// Re-created per test rather than cleared: clearing a vitest mock detaches the
// rejection tracking on its promise result, so a rejected lane surfaces as an
// unhandled rejection even though the handler awaited and caught it.
let tokenForPool = vi.fn();
vi.mock('../../api/_lib/market/ohlcv.js', () => ({
	tokenForPool: (...a) => tokenForPool(...a),
}));

const pair = (await import('../../api/coin/pair.js')).default;

// The real three / SOL pool, the one DEXTools keys $THREE under.
const THREE_PAIR = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const EVM_PAIR = '0x1234567890abcdef1234567890abcdef12345678';

const market = {
	pool: THREE_PAIR,
	token: { address: THREE_MINT, name: 'three.ws', symbol: 'three' },
	quote: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
	dex: 'meteora',
	pairName: 'three / SOL',
};

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) {
			this._h[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._h[k.toLowerCase()];
		},
		end(body) {
			this._body = body;
		},
	};
}
async function call(query) {
	const res = makeRes();
	await pair({ url: `/api/coin/pair?${query}`, method: 'GET', headers: {} }, res);
	return { res, body: JSON.parse(res._body) };
}

describe('/api/coin/pair', () => {
	beforeEach(() => {
		tokenForPool = vi.fn();
	});

	it('resolves a Solana pool address to the token it trades', async () => {
		tokenForPool.mockResolvedValue(market);
		const { res, body } = await call(`address=${THREE_PAIR}&network=solana`);
		expect(res.statusCode).toBe(200);
		expect(body.pair).toBe(THREE_PAIR);
		expect(body.token.address).toBe(THREE_MINT);
		expect(body.token.symbol).toBe('three');
		expect(body.quote.symbol).toBe('SOL');
		expect(body.dex).toBe('meteora');
		// `pool` is renamed to `pair` on the way out: callers of this route hold a
		// pair address, and answering with a second name for it invites confusion
		// with /api/coin/pool, which means the opposite direction.
		expect(body).not.toHaveProperty('pool');
	});

	it('is CORS-open and cacheable, because partner pages call it from the browser', async () => {
		tokenForPool.mockResolvedValue(market);
		const { res } = await call(`address=${THREE_PAIR}&network=solana`);
		expect(res.getHeader('access-control-allow-origin')).toBe('*');
		expect(res.getHeader('cache-control')).toContain('s-maxage=300');
	});

	it('defaults to Solana, the home chain', async () => {
		tokenForPool.mockResolvedValue(market);
		const { res } = await call(`address=${THREE_PAIR}`);
		expect(res.statusCode).toBe(200);
		expect(tokenForPool).toHaveBeenCalledWith(THREE_PAIR, 'solana');
	});

	it('accepts an EVM pool address on an EVM network', async () => {
		tokenForPool.mockResolvedValue({ ...market, pool: EVM_PAIR });
		const { res } = await call(`address=${EVM_PAIR}&network=base`);
		expect(res.statusCode).toBe(200);
	});

	it('rejects an address that is the wrong shape for the network', async () => {
		const evmOnSolana = await call(`address=${EVM_PAIR}&network=solana`);
		expect(evmOnSolana.res.statusCode).toBe(400);
		expect(evmOnSolana.body.error).toBe('bad_address');

		const solOnBase = await call(`address=${THREE_PAIR}&network=base`);
		expect(solOnBase.res.statusCode).toBe(400);
		expect(tokenForPool).not.toHaveBeenCalled();
	});

	it('rejects an unsupported network', async () => {
		const { res, body } = await call(`address=${THREE_PAIR}&network=dogechain`);
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('bad_network');
		expect(tokenForPool).not.toHaveBeenCalled();
	});

	it('answers 404 for a pool no source has indexed', async () => {
		tokenForPool.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
		const { res, body } = await call(`address=${THREE_PAIR}&network=solana`);
		expect(res.statusCode).toBe(404);
		expect(body.error).toBe('no_pair');
	});

	it('passes a throttle through as 429 so the caller can retry', async () => {
		tokenForPool.mockRejectedValue(Object.assign(new Error('slow down'), { status: 429 }));
		const { res, body } = await call(`address=${THREE_PAIR}&network=solana`);
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
	});

	it('maps an untagged failure to 502, never a 500', async () => {
		// AbortSignal.timeout rejects with a DOMException carrying no `status`.
		tokenForPool.mockRejectedValue(new Error('socket hang up'));
		const { res, body } = await call(`address=${THREE_PAIR}&network=solana`);
		expect(res.statusCode).toBe(502);
		expect(body.error).toBe('upstream_error');
	});
});
