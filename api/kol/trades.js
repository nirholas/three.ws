// GET /api/kol/trades?mint=<mint>&limit=<n>
//
// Returns recent trades for a Solana token mint filtered to smart-money wallets.
// Wallet qualification rule: minimum $10 000 cumulative realised P&L (see
// src/kol/wallets.js).
//
// TODO: wire up a real trade source (Helius enriched-transactions, Birdeye,
//       or a self-hosted indexer). Today the trades array is always empty.

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { KOL_WALLETS } from '../../src/kol/wallets.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const mint = url.searchParams.get('mint');
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20')));

	if (!mint) return error(res, 400, 'validation_error', 'mint is required');

	// TODO: query enriched transactions for `mint` from indexer, filter to
	//       KOL_WALLETS addresses, map to the trade shape below.
	// Trade shape: { time: ISO8601, side: 'buy'|'sell', wallet: string,
	//               usd: number, source: 'kol'|'whale'|'smart-money' }
	const trades = [];

	return json(res, 200, { mint, trades, wallets: KOL_WALLETS.length });
});
