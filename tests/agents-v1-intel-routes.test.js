import { describe, expect, it } from 'vitest';
import { ROUTES as INTEL } from '../api/_lib/agents-v1/routes/intel.js';
import { ROUTES as REST } from '../api/v1/rest.js';
import { computeIndicators } from '../api/_lib/trading-tools/market.js';

const route = (path) => INTEL.find((r) => r.path === path);
const call = (path, query) => Promise.resolve().then(() => route(path).handler({ query }));

/** Wilder's RSI, written out from the definition: SMA seed, then smoothed averages. */
function wilderRsi(closes, n) {
	let gain = 0;
	let loss = 0;
	for (let i = 1; i <= n; i++) {
		const d = closes[i] - closes[i - 1];
		if (d >= 0) gain += d; else loss -= d;
	}
	gain /= n;
	loss /= n;
	const rsi = (g, l) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
	let value = rsi(gain, loss);
	for (let i = n + 1; i < closes.length; i++) {
		const d = closes[i] - closes[i - 1];
		gain = (gain * (n - 1) + Math.max(d, 0)) / n;
		loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
		value = rsi(gain, loss);
	}
	return value;
}

// A deterministic, non-trivial price path (no randomness, no network).
const closes = Array.from({ length: 120 }, (_, i) => 100 + 12 * Math.sin(i / 5) + 0.15 * i + (i % 7) * 0.4);

describe('intel routes are mounted', () => {
	it.each(['price', 'top-movers', 'indicators', 'signals', 'anomalies', 'macro'])('GET /intel/%s', (name) => {
		const hit = REST.find((r) => r.method === 'GET' && r.path === `/intel/${name}`);
		expect(hit).toBeTruthy();
		expect(hit.scope).toBe('agents:read');
	});
	it('mounts only the read side of the agent wallet', () => {
		const wallet = REST.filter((r) => r.path.startsWith('/agents/:id/wallet'));
		expect(wallet.map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /agents/:id/wallet', 'GET /agents/:id/wallet/history']);
	});
	it('does not mount swap execution or transfers', () => {
		expect(REST.some((r) => /swap\/execute|transfer|external-wallet/.test(r.path))).toBe(false);
	});
});

describe('intel input validation', () => {
	it('requires a mint', async () => {
		for (const p of ['/intel/price', '/intel/signals', '/intel/indicators']) {
			await expect(call(p, {})).rejects.toMatchObject({ status: 400, code: 'invalid_parameter' });
		}
	});
	it('rejects an unknown window, board and interval', async () => {
		await expect(call('/intel/macro', { window: '3y' })).rejects.toMatchObject({ status: 400 });
		await expect(call('/intel/anomalies', { window: 'x' })).rejects.toMatchObject({ status: 400 });
		await expect(call('/intel/top-movers', { board: 'nope' })).rejects.toMatchObject({ status: 400 });
		await expect(call('/intel/top-movers', { limit: '500' })).rejects.toMatchObject({ status: 400 });
		await expect(call('/intel/indicators', { mint: 'M', interval: '2s' })).rejects.toMatchObject({ status: 400 });
	});
});

describe('indicators', () => {
	it('RSI stays inside 0..100 and matches a reference Wilder calculation', () => {
		for (const period of [7, 14, 21]) {
			const out = computeIndicators(closes, { indicators: ['rsi'], period });
			expect(out.rsi.value).toBeGreaterThanOrEqual(0);
			expect(out.rsi.value).toBeLessThanOrEqual(100);
			for (const v of out.rsi.series.filter((x) => x != null)) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(100);
			}
			expect(out.rsi.value).toBeCloseTo(wilderRsi(closes, period), 3);
		}
	});
	it('RSI is 100 on a strictly rising series and near 0 on a strictly falling one', () => {
		const up = Array.from({ length: 40 }, (_, i) => 10 + i);
		const down = Array.from({ length: 40 }, (_, i) => 100 - i);
		expect(computeIndicators(up, { indicators: ['rsi'] }).rsi.value).toBe(100);
		expect(computeIndicators(down, { indicators: ['rsi'] }).rsi.value).toBeLessThan(1);
	});
	it('computes every requested indicator', () => {
		const out = computeIndicators(closes, { indicators: ['rsi', 'ema', 'sma', 'macd', 'bbands'] });
		expect(Object.keys(out).sort()).toEqual(['bbands', 'ema', 'macd', 'rsi', 'sma']);
	});
});
