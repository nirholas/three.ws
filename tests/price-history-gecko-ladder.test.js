// /api/pump/price-history answered 502 on 9 of 248 calls on 2026-11-25,
// including the $THREE chart itself. Two causes, both in its GeckoTerminal rung:
//
// 1. GeckoTerminal only accepts aggregate 1/5/15 for minutes, 1/4/12 for hours
//    and 1 for days. The rung asked for minute/3, minute/30, hour/2, hour/6,
//    hour/8, day/3, day/7 and day/30, which GeckoTerminal rejects with a 400
//    every time, so 3m, 30m, 2H, 6H, 8H, 3D, 1W and 1M only ever charted when a
//    later rung happened to answer.
// 2. It called GeckoTerminal directly with a before_timestamp that changes every
//    30s and kept its only fallback copy in this instance's memory for 15
//    minutes. A free-tier 429 on an instance without a recent copy was a 502,
//    although the shared OHLCV ladder (api/_lib/market/ohlcv.js) holds a 24h
//    last-good copy in the shared cache and a Birdeye pair rung behind it.
//
// The rung now asks the shared ladder for the nearest supported base aggregate
// and folds the candles up to the requested width.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: vi.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })) },
	clientIp: () => '203.0.113.9',
}));
vi.mock('../api/_lib/birdeye.js', () => ({
	birdeyeConfigured: () => false,
	fetchBirdeyeOhlcv: vi.fn(),
}));
// The on-chain candle rung sees no trades, as pump.fun's retired candle API
// once answered 404: these tests are about the GeckoTerminal ladder.
vi.mock('../api/_lib/pump-chain-trades.js', () => ({
	fetchChainTradePage: vi.fn(async () => ({ rows: [], cursor: null, hasMore: false })),
}));

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const POOL = 'THREEsynthetic1111111111111111111111111111';
const ALLOWED = { minute: [1, 5, 15], hour: [1, 4, 12], day: [1] };
const STEP = { minute: 60, hour: 3600, day: 86_400 };

const state = { throttle: false, ohlcvAsks: [] };

function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function geckoCandles(timeframe, aggregate) {
	const width = STEP[timeframe] * aggregate;
	const newest = Math.floor(Date.now() / 1000 / width) * width;
	const rows = [];
	for (let i = 0; i < 1000; i++) {
		const t = newest - i * width;
		const p = 0.0003 + (i % 7) * 0.000001;
		rows.push([t, p, p * 1.01, p * 0.99, p, 10]);
	}
	return rows;
}

function fakeFetch(url) {
	const u = new URL(String(url));
	if (u.host === 'api.geckoterminal.com') {
		if (state.throttle) return jsonResponse(429, { status: { error_code: 429, error_message: 'rate limited' } });
		if (u.pathname.endsWith(`/tokens/${MINT}/pools`)) {
			return jsonResponse(200, { data: [{ id: `solana_${POOL}`, attributes: { address: POOL } }] });
		}
		const m = u.pathname.match(/\/pools\/[^/]+\/ohlcv\/(minute|hour|day)$/);
		if (m) {
			const timeframe = m[1];
			const aggregate = Number(u.searchParams.get('aggregate'));
			state.ohlcvAsks.push(`${timeframe}/${aggregate}`);
			if (!ALLOWED[timeframe].includes(aggregate)) {
				return jsonResponse(400, { errors: [{ status: '400', title: `Invalid aggregate. Allowed values: ${ALLOWED[timeframe].join(', ')}` }] });
			}
			return jsonResponse(200, { data: { attributes: { ohlcv_list: geckoCandles(timeframe, aggregate) } }, meta: {} });
		}
	}
	if (u.host === 'api.dexscreener.com') {
		return state.throttle ? jsonResponse(429, {}) : jsonResponse(200, { pairs: [] });
	}
	return jsonResponse(404, {});
}

let handler;
beforeEach(async () => {
	vi.resetModules();
	state.throttle = false;
	state.ohlcvAsks = [];
	vi.stubGlobal('fetch', vi.fn(async (url) => fakeFetch(url)));
	({ default: handler } = await import('../api/pump/price-history.js'));
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function call(interval) {
	const req = { method: 'GET', url: `/api/pump/price-history?mint=${MINT}&interval=${interval}`, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
	};
	return handler(req, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }));
}

const WIDTH = { '3m': 180, '30m': 1800, '2H': 7200, '6H': 21_600, '8H': 28_800, '3D': 259_200, '1W': 604_800, '1M': 2_592_000 };

describe('price-history GeckoTerminal rung', () => {
	for (const [interval, width] of Object.entries(WIDTH)) {
		it(`charts ${interval} by folding a GeckoTerminal base aggregate it accepts`, async () => {
			const { status, body } = await call(interval);
			expect(status).toBe(200);
			expect(body.data.length).toBeGreaterThan(0);
			for (const c of body.data) expect(c.t % width).toBe(0);
			for (const ask of state.ohlcvAsks) {
				const [tf, agg] = ask.split('/');
				expect(ALLOWED[tf]).toContain(Number(agg));
			}
		});
	}

	it('serves the shared last-good candles when GeckoTerminal throttles after the local copy expired', async () => {
		const first = await call('1H');
		expect(first.status).toBe(200);
		const realNow = Date.now();
		vi.spyOn(Date, 'now').mockReturnValue(realNow + 16 * 60_000);
		state.throttle = true;
		const second = await call('1H');
		expect(second.status).toBe(200);
		expect(second.body.data.length).toBeGreaterThan(0);
	}, 30_000);
});
