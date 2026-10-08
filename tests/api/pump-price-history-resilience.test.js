// api/pump/price-history.js — GeckoTerminal resilience under a poll-storm.
//
// Regression: /terminal, /trades, and /pump-dashboard each mount several chart
// widgets that poll different mints at once, so a single page load is itself
// a burst of near-simultaneous requests. Confirmed live in production
// 2026-07-16 (fresh page-audit run): several distinct mints 502'd with
// "Price history is unavailable" even though GeckoTerminal itself recovers
// within seconds — the old code only retried once, only on 429, with no cap
// on how many of OUR OWN requests could be in flight at once and no sharing
// between concurrent callers asking for the identical window. This file pins
// the fix: a concurrency gate, retry on 429/5xx/network error, and in-flight
// de-duplication.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/_lib/birdeye.js', () => ({
	birdeyeConfigured: () => false,
	fetchBirdeyeOhlcv: vi.fn(),
}));
vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));

import handler, {
	snapWindow,
	POLL_BUCKET_SECONDS,
	aggregateCandles,
	mapPumpCandles,
} from '../../api/pump/price-history.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo7';

function makeReq(qs) {
	return { url: `/api/pump/price-history?${qs}`, method: 'GET', headers: {} };
}
function makeRes() {
	const res = {
		statusCode: 200,
		_headers: {},
		_body: null,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(body) { this._body = body; },
	};
	return res;
}
function getJson(res) { return JSON.parse(res._body); }

// Real Response objects: the pool lookup runs through the shared market
// resolver (api/_lib/market/ohlcv.js), which reads bodies and headers the way
// fetch hands them back.
function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function poolResponse() {
	return jsonResponse(200, { data: [{ attributes: { address: POOL } }] });
}
function ohlcvResponse() {
	return jsonResponse(200, {
		data: { attributes: { ohlcv_list: [[Math.floor(Date.now() / 1000) - 60, 1, 1.1, 0.9, 1.05, 100]] } },
	});
}

// Base58 alphabet (no 0/O/I/l) so a generated test mint always passes
// isPlausibleMint's base58 regex.
const BASE58_SAFE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz123456789';
function safeSuffix(n) {
	let s = '', x = n + 1;
	for (let i = 0; i < 6; i++) { s += BASE58_SAFE[x % BASE58_SAFE.length]; x = Math.floor(x / BASE58_SAFE.length); }
	return s;
}

// A fresh mint AND a fresh, un-bucket-collided window per test so neither the
// pool-address cache nor the candle/in-flight cache (both module-level, keyed
// by mint) can leak state between tests.
let seq = 0;
function freshQuery(mint) {
	seq += 1;
	const m = mint || `${MINT.slice(0, 34)}${safeSuffix(seq)}pump`;
	const now = Math.floor(Date.now() / 1000) + seq * 10_000; // force a new snapWindow bucket
	const { from, to } = snapWindow({ interval: '5m', from: now - 3600, to: now });
	return `mint=${m}&interval=5m&from=${from}&to=${to}`;
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('geckoFetch retry (via the handler)', () => {
	it('recovers from a single 429 (existing behavior, still works)', async () => {
		let call = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			call += 1;
			if (call === 1) return poolResponse();
			if (call === 2) return jsonResponse(429, {});
			return ohlcvResponse();
		});
		const res = makeRes();
		await handler(makeReq(freshQuery()), res);
		expect(res.statusCode).toBe(200);
		expect(getJson(res).source).toBe('gecko');
	});

	it('recovers from a transient 502 from GeckoTerminal — the case that used to 502 the caller', async () => {
		let call = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			call += 1;
			if (call === 1) return poolResponse();
			if (call === 2) return jsonResponse(502, {});
			return ohlcvResponse();
		});
		const res = makeRes();
		await handler(makeReq(freshQuery()), res);
		expect(res.statusCode).toBe(200);
		expect(getJson(res).source).toBe('gecko');
	});

	it('recovers from a dropped connection (fetch throws) — previously not retried at all', async () => {
		let call = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			call += 1;
			if (call === 1) return poolResponse();
			if (call === 2) throw new Error('network error');
			return ohlcvResponse();
		});
		const res = makeRes();
		await handler(makeReq(freshQuery()), res);
		expect(res.statusCode).toBe(200);
	});

	it('still 502s honestly when every attempt fails and there is no stale fallback', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(500, {}));
		const res = makeRes();
		await handler(makeReq(freshQuery()), res);
		expect(res.statusCode).toBe(502);
		expect(getJson(res).error).toBe('upstream_error');
	});

	it('serves the honest no_market 404 when neither GeckoTerminal nor pump.fun has a market, without retrying', async () => {
		let poolCalls = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url).includes('/pools?')) { poolCalls += 1; return jsonResponse(404, {}); }
			if (String(url).includes('swap-api.pump.fun')) return jsonResponse(404, {});
			throw new Error('should never reach the ohlcv endpoint');
		});
		const res = makeRes();
		await handler(makeReq(freshQuery()), res);
		expect(res.statusCode).toBe(404);
		expect(getJson(res).error).toBe('no_market');
		expect(poolCalls).toBe(1); // a 404 is a real answer, not a transient failure — never retried
	});
});

describe('pump.fun candle rung', () => {
	it('charts a young pump.fun coin GeckoTerminal has not indexed yet', async () => {
		const now = Math.floor(Date.now() / 1000);
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url).includes('/pools?')) return jsonResponse(404, {});
			if (String(url).includes('swap-api.pump.fun')) {
				return {
					ok: true,
					status: 200,
					json: async () => [
						{ timestamp: (now - 600) * 1000, open: '0.0000027', high: '0.0000029', low: '0.0000026', close: '0.0000028', volume: '65.2' },
					],
				};
			}
			throw new Error(`unexpected upstream ${url}`);
		});
		const res = makeRes();
		await handler(makeReq(`mint=${MINT.slice(0, 34)}${safeSuffix(90_001)}pump&interval=5m&from=${now - 3600}&to=${now}`), res);
		expect(res.statusCode).toBe(200);
		const body = getJson(res);
		expect(body.source).toBe('pumpfun');
		expect(body.data).toHaveLength(1);
		expect(body.data[0].c).toBeCloseTo(0.0000028, 12);
	});

	it('maps string-typed millisecond rows and drops unusable ones', () => {
		const rows = mapPumpCandles([
			{ timestamp: 1_789_614_480_000, open: '2', high: '3', low: '1', close: '2.5', volume: '10' },
			{ timestamp: 1_789_614_420_000, open: '1', high: '2', low: '1', close: '2', volume: 'x' },
			{ timestamp: 'bad', open: '1', high: '1', low: '1', close: '1', volume: '1' },
			{ timestamp: 1_789_614_540_000, open: '1', high: '1', low: '1', close: '0', volume: '1' },
		]);
		expect(rows.map((r) => r.t)).toEqual([1_789_614_420, 1_789_614_480]);
		expect(rows[0].v).toBe(0);
		expect(mapPumpCandles(null)).toEqual([]);
	});

	it('folds base candles into epoch-aligned buckets for intervals pump.fun lacks', () => {
		const out = aggregateCandles(
			[
				{ t: 7200, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
				{ t: 10800, o: 1.5, h: 4, l: 1, c: 3, v: 5 },
				{ t: 14400, o: 3, h: 3, l: 2, c: 2.5, v: 1 },
			],
			7200,
		);
		expect(out).toEqual([
			{ t: 7200, o: 1, h: 4, l: 0.5, c: 3, v: 15 },
			{ t: 14400, o: 3, h: 3, l: 2, c: 2.5, v: 1 },
		]);
	});
});

describe('concurrency gate', () => {
	it('never runs more than 4 GeckoTerminal fetches at once, even under a burst across many mints', async () => {
		let active = 0;
		let maxActive = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((r) => setTimeout(r, 5));
			active -= 1;
			if (String(url).includes('/pools?')) return poolResponse();
			return ohlcvResponse();
		});

		// 10 distinct mints (distinct pool-cache keys) fired at once — a realistic
		// stand-in for a page mounting several chart widgets simultaneously.
		const mints = Array.from({ length: 10 }, (_, i) => `${MINT.slice(0, 34)}${safeSuffix(10_000 + i)}pump`);
		await Promise.all(mints.map((m) => {
			const res = makeRes();
			return handler(makeReq(freshQuery(m)), res).then(() => res);
		}));

		expect(maxActive).toBeLessThanOrEqual(4);
	});
});

describe('in-flight de-duplication', () => {
	it('collapses concurrent identical requests into one upstream resolution', async () => {
		let poolCalls = 0;
		let ohlcvCalls = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			await new Promise((r) => setTimeout(r, 10));
			if (String(url).includes('/pools?')) { poolCalls += 1; return poolResponse(); }
			ohlcvCalls += 1;
			return ohlcvResponse();
		});

		const qs = freshQuery();
		const results = await Promise.all(
			Array.from({ length: 5 }, () => {
				const res = makeRes();
				return handler(makeReq(qs), res).then(() => res);
			}),
		);

		for (const res of results) expect(res.statusCode).toBe(200);
		// 5 concurrent identical requests share ONE resolution — one pool lookup,
		// one ohlcv fetch — not five independent chains.
		expect(poolCalls).toBe(1);
		expect(ohlcvCalls).toBe(1);
	});
});

// Production 2026-10-08: the Birdeye rung's own fallback (api/_lib/birdeye.js)
// had already asked GeckoTerminal for the mint's pools and been told "none".
// This handler then re-asked the identical URL milliseconds later, the shared
// Cloud Run egress drew 429s on it, the throttle read as an outage, and a coin
// with no market anywhere answered 502 instead of no_market.
describe('pool lookup shares the market resolver', () => {
	it('reuses the earlier "no pools" answer instead of re-asking a throttled GeckoTerminal', async () => {
		const { topPoolForToken } = await import('../../api/_lib/market/ohlcv.js');
		const mint = `${MINT.slice(0, 34)}${safeSuffix(77_001)}pump`;
		let poolCalls = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u.includes('/pools?')) {
				poolCalls += 1;
				return poolCalls === 1 ? jsonResponse(200, { data: [] }) : jsonResponse(429, {});
			}
			if (u.includes('api.dexscreener.com')) return jsonResponse(200, { pairs: [] });
			if (u.includes('swap-api.pump.fun')) return jsonResponse(200, []);
			throw new Error(`unexpected upstream ${u}`);
		});

		// What the Birdeye rung's GeckoTerminal fallback does first in production.
		await expect(topPoolForToken(mint, 'solana')).rejects.toMatchObject({ status: 404 });

		const res = makeRes();
		await handler(makeReq(freshQuery(mint)), res);
		expect(res.statusCode).toBe(404);
		expect(getJson(res).error).toBe('no_market');
		expect(poolCalls).toBe(1);
	});
});
