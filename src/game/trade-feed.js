// Trade tape source for the chart screen and everything fed from it (market
// reactor, activity ticker, hype moments).
//
// Primary: /api/pump/coin-trades (pump.fun swap API) for Solana mints and
// /api/robinhood/coin-trades for 0x coins. Fallback, Solana only:
// /api/pump/dex-trades (GeckoTerminal), which covers coins that graduated off
// the bonding curve and keeps the tape alive when pump.fun's swap API answers
// 403 behind its Cloudflare challenge. $THREE is a graduated coin, so without
// this fallback its in-world tape, ticker and hype moments sit empty.

const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// mint -> epoch ms until which the primary feed is skipped. A primary that just
// answered stale-empty is not worth a wasted request on every 5 s poll.
const SKIP_PRIMARY_MS = 60_000;
const skipPrimaryUntil = new Map();

/** Forget which feeds were recently stale (tests, and a manual refresh). */
export function resetTradeFeedMemo() { skipPrimaryUntil.clear(); }

/** Map one /api/pump/dex-trades row onto the coin-trades row shape. */
export function dexTradeToTape(t) {
	const tx = t?.signature || t?.tx_signature;
	const usd = Number(t?.sol_value_usd);
	const sol = Number(t?.sol_amount);
	const tokens = Number(t?.token_amount);
	const hasUsd = Number.isFinite(usd) && usd > 0;
	const hasSol = Number.isFinite(sol) && sol > 0;
	if (!tx || (!hasUsd && !hasSol)) return null;
	const ts = Number(t.timestamp);
	return {
		tx,
		timestamp: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null,
		user: t.trader || null,
		is_buy: t.is_buy === true,
		sol_amount: hasSol ? sol : null,
		usd_amount: hasUsd ? usd : null,
		price_usd: hasUsd && tokens > 0 ? usd / tokens : null,
	};
}

async function getTrades(fetchImpl, url) {
	const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
	if (!r.ok) throw new Error('HTTP ' + r.status);
	const data = await r.json();
	return { trades: Array.isArray(data?.trades) ? data.trades : [], stale: data?.stale === true };
}

/**
 * Recent trades for a coin as coin-trades rows (newest-first not guaranteed).
 * Throws only when every available feed failed, so callers can mark the tape
 * stale; a quiet market resolves to [].
 */
export async function fetchTradeTape(mint, { limit = 100, fetchImpl = fetch } = {}) {
	const evm = EVM_ADDR_RE.test(mint);
	const base = evm ? '/api/robinhood/coin-trades' : '/api/pump/coin-trades';
	const q = encodeURIComponent(mint);
	let primary = null;
	let primaryErr = null;
	const skipPrimary = !evm && Date.now() < (skipPrimaryUntil.get(mint) || 0);
	if (!skipPrimary) {
		try {
			primary = await getTrades(fetchImpl, `${base}?mint=${q}&limit=${limit}`);
		} catch (err) {
			primaryErr = err;
		}
		if (primary && (primary.trades.length || !primary.stale)) {
			skipPrimaryUntil.delete(mint);
			return primary.trades;
		}
		if (primary && skipPrimaryUntil.size < 50) skipPrimaryUntil.set(mint, Date.now() + SKIP_PRIMARY_MS);
	}
	if (evm) {
		if (primaryErr) throw primaryErr;
		return primary.trades;
	}
	try {
		const dex = await getTrades(fetchImpl, `/api/pump/dex-trades?mint=${q}&limit=${Math.min(limit, 50)}`);
		return dex.trades.map(dexTradeToTape).filter(Boolean);
	} catch (err) {
		throw primaryErr || err;
	}
}
