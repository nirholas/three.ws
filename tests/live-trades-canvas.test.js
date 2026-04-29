import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTrades, filterNewTrades } from '../src/widgets/live-trades-canvas.js';

// ── fetchTrades ─────────────────────────────────────────────────────────────

function makeMcpFetch(tradePayload) {
	return async (_url, _opts) => ({
		ok: true,
		json: async () => ({
			jsonrpc: '2.0',
			id: 1,
			result: {
				content: [{ type: 'text', text: JSON.stringify({ trades: tradePayload }) }],
			},
		}),
	});
}

describe('fetchTrades', () => {
	it('returns normalized trades from MCP response', async () => {
		const raw = [
			{ signature: 'sig1', is_buy: true, sol_amount: 1.5, usd_value: 225, timestamp: 1000 },
			{ signature: 'sig2', is_buy: false, sol_amount: 0.3, usd_value: 45, timestamp: 999 },
		];
		const trades = await fetchTrades('mint123', 20, makeMcpFetch(raw));
		expect(trades).toHaveLength(2);
		expect(trades[0].signature).toBe('sig1');
		expect(trades[0].isBuy).toBe(true);
		expect(trades[0].solAmount).toBe(1.5);
		expect(trades[0].usdValue).toBe(225);
		expect(trades[1].isBuy).toBe(false);
	});

	it('returns null when the MCP response has no trades', async () => {
		const fetch = async () => ({
			ok: true,
			json: async () => ({
				jsonrpc: '2.0',
				id: 1,
				result: { content: [{ type: 'text', text: '{}' }] },
			}),
		});
		const result = await fetchTrades('mint123', 20, fetch);
		expect(result).toBeNull();
	});

	it('returns null on non-ok HTTP status', async () => {
		const fetch = async () => ({ ok: false, status: 503 });
		const result = await fetchTrades('mint123', 20, fetch);
		expect(result).toBeNull();
	});

	it('returns null when fetch throws', async () => {
		const fetch = async () => { throw new Error('network'); };
		const result = await fetchTrades('mint123', 20, fetch);
		expect(result).toBeNull();
	});

	it('handles alternative field names (isBuy, usdValue)', async () => {
		const raw = [{ signature: 'alt1', isBuy: true, solAmount: 2, usdValue: 300, timestamp: 1 }];
		const trades = await fetchTrades('mint', 20, makeMcpFetch(raw));
		expect(trades[0].isBuy).toBe(true);
		expect(trades[0].usdValue).toBe(300);
	});

	it('handles direction field for buy/sell', async () => {
		const raw = [{ signature: 'dir1', direction: 'sell', sol_amount: 0.5, usd_value: 75, timestamp: 1 }];
		const trades = await fetchTrades('mint', 20, makeMcpFetch(raw));
		expect(trades[0].isBuy).toBe(false);
	});
});

// ── filterNewTrades ─────────────────────────────────────────────────────────

describe('filterNewTrades', () => {
	it('returns only unseen trades', () => {
		const seen = new Set(['sig1']);
		const incoming = [
			{ signature: 'sig1', isBuy: true, usdValue: 100 },
			{ signature: 'sig2', isBuy: false, usdValue: 50 },
		];
		const fresh = filterNewTrades(incoming, seen, 0);
		expect(fresh).toHaveLength(1);
		expect(fresh[0].signature).toBe('sig2');
	});

	it('filters trades below minUsd', () => {
		const seen = new Set();
		const incoming = [
			{ signature: 'a', isBuy: true, usdValue: 600 },
			{ signature: 'b', isBuy: false, usdValue: 100 },
		];
		const fresh = filterNewTrades(incoming, seen, 500);
		expect(fresh).toHaveLength(1);
		expect(fresh[0].signature).toBe('a');
	});

	it('returns empty array when all trades are already seen', () => {
		const seen = new Set(['x', 'y']);
		const incoming = [
			{ signature: 'x', isBuy: true, usdValue: 10 },
			{ signature: 'y', isBuy: false, usdValue: 20 },
		];
		expect(filterNewTrades(incoming, seen, 0)).toHaveLength(0);
	});

	it('handles null/undefined incoming gracefully', () => {
		expect(filterNewTrades(null, new Set(), 0)).toEqual([]);
		expect(filterNewTrades(undefined, new Set(), 0)).toEqual([]);
	});

	it('passes trades at exactly the minUsd threshold', () => {
		const seen = new Set();
		const incoming = [{ signature: 'z', isBuy: true, usdValue: 500 }];
		// minUsd=500 means >= 500 passes (filter is < minUsd rejects)
		expect(filterNewTrades(incoming, seen, 500)).toHaveLength(1);
	});
});
