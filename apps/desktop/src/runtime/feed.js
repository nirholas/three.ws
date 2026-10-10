// Real pump.fun launch feed, fetched directly from this machine so a strategy
// keeps evaluating while three.ws is unreachable. Mainnet only: the venue has
// no public devnet feed, so devnet agents see no entries (open positions still
// exit). Mirrors api/_lib/pump-launch-feed.js normalizeLaunch.

const BASE = process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';
const UA = 'three.ws-desktop-runtime/1';

async function getJson(fetchImpl, url, ms = 8000) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), ms);
	try {
		const r = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': UA } });
		return r.ok ? await r.json() : null;
	} catch {
		return null;
	} finally {
		clearTimeout(t);
	}
}

export function normalizeLaunch(c, solUsd = 0) {
	if (!c?.mint) return null;
	const real = Number(c.real_sol_reserves);
	const virt = Number(c.virtual_sol_reserves);
	return {
		mint: c.mint, name: c.name || null, symbol: c.symbol || null,
		created_at: c.created_timestamp ? Number(c.created_timestamp) : null,
		market_cap_usd: typeof c.usd_market_cap === 'number' ? c.usd_market_cap : typeof c.market_cap === 'number' && solUsd > 0 ? c.market_cap * solUsd : null,
		liquidity_sol: real > 0 ? real / 1e9 : virt > 0 ? virt / 1e9 : null,
		creator: c.creator || null, creator_launches: null, creator_graduated: null,
		twitter: c.twitter || null, telegram: c.telegram || null, website: c.website || null,
		is_usdc_pair: false, graduated: c.complete === true || !!c.raydium_pool || !!c.pump_swap_pool,
	};
}

export function createPumpFeed({ fetchImpl = fetch, base = BASE, now = Date.now } = {}) {
	let sol = { at: 0, usd: 0 };
	// SOL/USD from Coinbase's public spot endpoint, cached a minute, so the
	// launch market cap (reported in SOL) can be gated in dollars.
	async function solUsd() {
		if (now() - sol.at < 60_000 && sol.usd > 0) return sol.usd;
		const d = await getJson(fetchImpl, 'https://api.coinbase.com/v2/prices/SOL-USD/spot');
		const usd = Number(d?.data?.amount);
		if (usd > 0) sol = { at: now(), usd };
		return sol.usd;
	}
	return {
		async launches({ network = 'mainnet', limit = 50 } = {}) {
			if (network !== 'mainnet') return [];
			const data = await getJson(fetchImpl, `${base}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`);
			const list = Array.isArray(data) ? data : Array.isArray(data?.coins) ? data.coins : [];
			const usd = await solUsd();
			return list.map((c) => normalizeLaunch(c, usd)).filter((l) => l && !l.graduated);
		},
		async coin(mint) {
			return getJson(fetchImpl, `${base}/coins/${encodeURIComponent(mint)}`);
		},
	};
}
