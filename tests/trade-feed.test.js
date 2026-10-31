import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTradeTape, dexTradeToTape, resetTradeFeedMemo } from '../src/game/trade-feed.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const dexRow = (over = {}) => ({
	signature: 'sigA', trader: 'Trader1', is_buy: true,
	token_amount: 1000, sol_amount: 0.5, sol_value_usd: 50, timestamp: 1793485801, ...over,
});

function jsonRes(body, ok = true, status = 200) {
	return { ok, status, json: async () => body };
}

describe('dexTradeToTape', () => {
	it('maps a dex-trades row onto the coin-trades shape the chart screen reads', () => {
		expect(dexTradeToTape(dexRow())).toEqual({
			tx: 'sigA',
			timestamp: new Date(1793485801 * 1000).toISOString(),
			user: 'Trader1',
			is_buy: true,
			sol_amount: 0.5,
			usd_amount: 50,
			price_usd: 0.05,
		});
	});
	it('drops rows with no signature or no size', () => {
		expect(dexTradeToTape(dexRow({ signature: null }))).toBeNull();
		expect(dexTradeToTape(dexRow({ sol_amount: 0, sol_value_usd: 0 }))).toBeNull();
	});
});

describe('fetchTradeTape', () => {
	beforeEach(() => resetTradeFeedMemo());

	it('stops asking a stale-empty primary on every poll, then retries it later', async () => {
		const fetchImpl = vi.fn(async (url) => url.includes('coin-trades')
			? jsonRes({ trades: [], stale: true })
			: jsonRes({ trades: [dexRow()] }));
		await fetchTradeTape(MINT, { fetchImpl });
		await fetchTradeTape(MINT, { fetchImpl });
		expect(fetchImpl.mock.calls.filter(([u]) => u.includes('coin-trades'))).toHaveLength(1);
		expect(fetchImpl.mock.calls.filter(([u]) => u.includes('dex-trades'))).toHaveLength(2);
		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + 61_000);
		await fetchTradeTape(MINT, { fetchImpl });
		vi.useRealTimers();
		expect(fetchImpl.mock.calls.filter(([u]) => u.includes('coin-trades'))).toHaveLength(2);
	});
	it('uses the primary feed when it has trades', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ trades: [{ tx: 't1', is_buy: true, sol_amount: 1 }] }));
		const out = await fetchTradeTape(MINT, { fetchImpl });
		expect(out).toHaveLength(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl.mock.calls[0][0]).toContain('/api/pump/coin-trades');
	});

	it('falls back to the graduated-pool feed when pump.fun is blocked (stale + empty)', async () => {
		const fetchImpl = vi.fn(async (url) => url.includes('coin-trades')
			? jsonRes({ mint: MINT, trades: [], stale: true, reason: 'upstream_403' })
			: jsonRes({ mint: MINT, trades: [dexRow()] }));
		const out = await fetchTradeTape(MINT, { fetchImpl });
		expect(out.map((t) => t.tx)).toEqual(['sigA']);
		expect(fetchImpl.mock.calls[1][0]).toContain('/api/pump/dex-trades');
	});

	it('falls back when the primary request itself fails', async () => {
		const fetchImpl = vi.fn(async (url) => {
			if (url.includes('coin-trades')) throw new Error('network');
			return jsonRes({ trades: [dexRow()] });
		});
		expect(await fetchTradeTape(MINT, { fetchImpl })).toHaveLength(1);
	});

	it('rethrows when every feed fails, so the chart can mark itself stale', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({}, false, 502));
		await expect(fetchTradeTape(MINT, { fetchImpl })).rejects.toThrow(/HTTP 502/);
	});

	it('returns an honest empty tape when both feeds are up but quiet', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ trades: [] }));
		expect(await fetchTradeTape(MINT, { fetchImpl })).toEqual([]);
	});

	it('never routes an EVM coin to the Solana pool feed', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ trades: [] }));
		await fetchTradeTape('0x' + 'a'.repeat(40), { fetchImpl });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl.mock.calls[0][0]).toContain('/api/robinhood/coin-trades');
	});
});
