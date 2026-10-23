// Market-data canaries. Each probe asks a source for something whose true value is
// known and checks the answer, so a source that is up but wrong (stuck price,
// wrong pair, shifted candles) fails the same way a dead one does.
//
//   price   every SOL/USD provider in sol-price.js must answer a positive number
//           within PRICE_BAND of the median of all answering providers.
//   candle  a closed historical daily SOL/USD candle (2025-01-01 UTC). It cannot
//           change, so the probe checks the timestamp, OHLC consistency and that
//           the close sits within CANDLE_TOLERANCE of the reference close.
//
// Verdicts are stored by data-canary-health.js and consumed by `orderByCanary`.

import { PROVIDERS as SOL_PRICE_PROVIDERS } from './sol-price.js';
import { recordCanary } from './data-canary-health.js';

const PROBE_TIMEOUT_MS = 6000;
const PRICE_BAND = 0.05;
const CANDLE_TOLERANCE = 0.02;
const UA = 'three.ws-data-canary/1.0';

/** Closed daily SOL/USD candle, 2025-01-01 UTC. Same bar on both venues. */
export const KNOWN_CANDLE = Object.freeze({ time: 1735689600, close: 193.84, low: 187.6, high: 194.99 });

const num = (v) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/**
 * Judge a normalized candle {time, open, high, low, close} against the reference.
 * @returns {{ ok: boolean, detail: string|null }}
 */
export function judgeCandle(c, ref = KNOWN_CANDLE, tolerance = CANDLE_TOLERANCE) {
	if (!c) return { ok: false, detail: 'no_candle' };
	if (c.time !== ref.time) return { ok: false, detail: `time_mismatch:${c.time}` };
	const { open, high, low, close } = c;
	if (![open, high, low, close].every((x) => x != null && x > 0)) return { ok: false, detail: 'non_positive' };
	if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return { ok: false, detail: 'ohlc_inconsistent' };
	if (Math.abs(close - ref.close) / ref.close > tolerance) return { ok: false, detail: `close_off:${close}` };
	return { ok: true, detail: null };
}

/**
 * Judge a set of price answers by agreement with their median.
 * @param {Record<string, number|null>} prices
 * @returns {Record<string, { ok: boolean, detail: string|null }>}
 */
export function judgePrices(prices, band = PRICE_BAND) {
	const live = Object.values(prices).filter((p) => p != null && p > 0).sort((a, b) => a - b);
	const median = live.length ? live[Math.floor((live.length - 1) / 2)] : null;
	const out = {};
	for (const [id, p] of Object.entries(prices)) {
		if (p == null || !(p > 0)) out[id] = { ok: false, detail: 'no_price' };
		else if (live.length < 2) out[id] = { ok: true, detail: null };
		else out[id] = Math.abs(p - median) / median <= band ? { ok: true, detail: null } : { ok: false, detail: `off_median:${p}` };
	}
	return out;
}

async function timed(fn) {
	const t0 = Date.now();
	try {
		return { value: await fn(), ms: Date.now() - t0, error: null };
	} catch (err) {
		return { value: null, ms: Date.now() - t0, error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'error' };
	}
}

async function fetchJson(url, headers = {}) {
	const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`http_${res.status}`);
	return res;
}

export const CANDLE_PROBES = [
	{
		id: 'kraken-ohlc',
		run: async () => {
			const res = await fetchJson(`https://api.kraken.com/0/public/OHLC?pair=SOLUSD&interval=1440&since=${KNOWN_CANDLE.time - 1}`);
			const row = (await res.json())?.result?.SOLUSD?.[0];
			return row ? { time: num(row[0]), open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]) } : null;
		},
	},
	{
		id: 'coinbase-candles',
		run: async () => {
			const iso = new Date(KNOWN_CANDLE.time * 1000).toISOString();
			const res = await fetchJson(`https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=86400&start=${iso}&end=${iso}`);
			const row = (await res.json())?.[0];
			// Coinbase order: [time, low, high, open, close, volume]
			return row ? { time: num(row[0]), low: num(row[1]), high: num(row[2]), open: num(row[3]), close: num(row[4]) } : null;
		},
	},
];

/** Run every probe, record every verdict, and return them. */
export async function runCanaries(now = Date.now()) {
	const verdicts = [];

	const priceRuns = await Promise.all(
		SOL_PRICE_PROVIDERS.map(async (p) => {
			const r = await timed(async () => {
				const res = await fetch(p.url, { headers: { accept: 'application/json', 'user-agent': UA, ...(p.init?.headers || {}) }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
				if (!res.ok) throw new Error(`http_${res.status}`);
				return p.parse ? p.parse(res) : res.json();
			});
			return { id: p.name, ...r };
		}),
	);
	const priceJudged = judgePrices(Object.fromEntries(priceRuns.map((r) => [r.id, num(r.value)])));
	for (const r of priceRuns) {
		const j = r.error ? { ok: false, detail: r.error } : priceJudged[r.id];
		verdicts.push(await recordCanary({ id: r.id, kind: 'price', ok: j.ok, latencyMs: r.ms, detail: j.detail, now }));
	}

	for (const probe of CANDLE_PROBES) {
		const r = await timed(probe.run);
		const j = r.error ? { ok: false, detail: r.error } : judgeCandle(r.value);
		verdicts.push(await recordCanary({ id: probe.id, kind: 'candle', ok: j.ok, latencyMs: r.ms, detail: j.detail, now }));
	}
	return verdicts;
}
