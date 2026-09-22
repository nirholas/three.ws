#!/usr/bin/env node
// Find a Solana token's main pool and summarize its OHLCV candles.
//
//   node scripts/candles.mjs <mint> [--interval 1H] [--bars 48] [--json]
//
// Reads two free, keyless three.ws endpoints:
//   GET /api/coin/pool?address=<mint>&network=solana        most-liquid pool
//   GET /api/pump/price-history?mint=<mint>&interval=<i>   [{t,o,h,l,c,v}]
// and prints the range, change, realized volatility and volume trend over the
// last N bars. Node 18+, no dependencies. THREE_WS_API_URL overrides the host.

const BASE = (process.env.THREE_WS_API_URL || 'https://three.ws').replace(/\/$/, '');
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1H', '2H', '4H', '6H', '8H', '12H', '1D', '3D', '1W', '1M'];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const mint = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const interval = flag('interval', '1H');
const bars = Math.max(2, Math.min(1000, Number.parseInt(flag('bars', '48'), 10) || 48));
const asJson = args.includes('--json');

if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
	console.error('usage: node scripts/candles.mjs <mint> [--interval 1H] [--bars 48] [--json]');
	process.exit(2);
}
if (!INTERVALS.includes(interval)) {
	console.error(`--interval must be one of ${INTERVALS.join(', ')}`);
	process.exit(2);
}

async function get(path) {
	const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${body?.error_description || body?.error || ''}`.trim());
	return body;
}

const [poolRes, historyRes] = await Promise.allSettled([
	get(`/api/coin/pool?address=${mint}&network=solana`),
	get(`/api/pump/price-history?mint=${mint}&interval=${interval}`),
]);
if (historyRes.status === 'rejected') {
	console.error(`price history unavailable: ${historyRes.reason.message}`);
	process.exit(1);
}

const candles = (historyRes.value.data || []).filter((c) => Number.isFinite(c.c)).slice(-bars);
if (candles.length < 2) {
	console.error(`not enough candles for ${mint} at ${interval} (got ${candles.length}); try a longer interval`);
	process.exit(1);
}

const first = candles[0];
const last = candles.at(-1);
const high = Math.max(...candles.map((c) => c.h));
const low = Math.min(...candles.map((c) => c.l));
const returns = candles.slice(1).map((c, i) => Math.log(c.c / candles[i].c)).filter(Number.isFinite);
const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
const stdev = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1));
const half = Math.floor(candles.length / 2);
const vol = (list) => list.reduce((s, c) => s + (c.v || 0), 0);
const volEarly = vol(candles.slice(0, half));
const volLate = vol(candles.slice(half));
const pct = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);

const summary = {
	mint,
	pool: poolRes.status === 'fulfilled' ? poolRes.value.pool || null : null,
	interval,
	bars: candles.length,
	source: historyRes.value.source || null,
	stale: Boolean(historyRes.value.stale),
	from: new Date(first.t * 1000).toISOString(),
	to: new Date(last.t * 1000).toISOString(),
	open: first.o,
	close: last.c,
	change_pct: Number(pct(last.c, first.o).toFixed(2)),
	high,
	low,
	range_pct: Number(pct(high, low).toFixed(2)),
	close_vs_high_pct: Number(pct(last.c, high).toFixed(2)),
	volatility_per_bar_pct: Number((stdev * 100).toFixed(2)),
	volume_total: Number(vol(candles).toFixed(4)),
	volume_trend_pct: Number(pct(volLate, volEarly).toFixed(1)),
};

if (asJson) {
	console.log(JSON.stringify(summary, null, 2));
} else {
	const p = (n) => (n < 0.01 ? n.toPrecision(4) : n.toFixed(4));
	console.log(`mint        ${mint}`);
	console.log(`pool        ${summary.pool || 'not found'}`);
	console.log(`window      ${summary.bars} x ${interval}  ${summary.from} -> ${summary.to}${summary.stale ? '  (STALE DATA)' : ''}`);
	console.log(`open/close  ${p(summary.open)} -> ${p(summary.close)}  (${summary.change_pct}%)`);
	console.log(`high/low    ${p(high)} / ${p(low)}  (range ${summary.range_pct}%, close ${summary.close_vs_high_pct}% from high)`);
	console.log(`volatility  ${summary.volatility_per_bar_pct}% per bar`);
	console.log(`volume      ${summary.volume_total} total, second half vs first ${summary.volume_trend_pct}%`);
}
