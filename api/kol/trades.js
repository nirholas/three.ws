// GET /api/kol/trades?mint=<mint>&limit=<n>
// Returns recent on-chain trades for a Solana token mint, filtered to wallets
// tagged in src/kol/wallets.js (smart-money / KOL / whale lists).

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { KOL_WALLETS, isSmartMoney, getWalletMeta } from '../../src/kol/wallets.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const mint = url.searchParams.get('mint');
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20')));
	if (!mint) return error(res, 400, 'validation_error', 'mint is required');

	// Indexer wiring lives in workers/pumpkit; until that source is plumbed
	// through to a queryable endpoint, return an empty trade list with the
	// total count of tracked wallets so the widget can render its empty state.
	const trades = await fetchTrades({ mint, limit }).catch(() => []);
	return json(res, 200, {
		mint,
		trades,
		wallets: KOL_WALLETS.length,
	});
});

async function fetchTrades({ mint, limit }) {
	// Optional Helius-enriched-transactions integration. Skipped when the
	// API key is unset so unit tests and dev environments don't make network
	// calls; production deploys set HELIUS_API_KEY to wire this up.
	const apiKey = process.env.HELIUS_API_KEY;
	if (!apiKey) return [];

	const url = `https://api.helius.xyz/v0/addresses/${encodeURIComponent(mint)}/transactions?api-key=${apiKey}&limit=${limit}&type=SWAP`;
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	try {
		const res = await fetch(url, { signal: ctrl.signal });
		if (!res.ok) return [];
		const txs = await res.json();
		const out = [];
		for (const tx of Array.isArray(txs) ? txs : []) {
			const wallet = tx.feePayer || tx.source || null;
			if (!wallet || !isSmartMoney(wallet)) continue;
			const swap = tx.events?.swap;
			if (!swap) continue;
			const tokenIn = swap.tokenInputs?.[0]?.mint;
			const side = tokenIn === mint ? 'sell' : 'buy';
			const usd = Number(swap.nativeOutput?.amountUsd || swap.nativeInput?.amountUsd || 0);
			const meta = getWalletMeta(wallet);
			const source = meta?.tags?.[0] || 'smart-money';
			out.push({
				time: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : new Date().toISOString(),
				side,
				wallet,
				usd,
				source,
			});
		}
		return out.slice(0, limit);
	} catch {
		return [];
	} finally {
		clearTimeout(t);
	}
}
