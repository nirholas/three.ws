// Pump.fun live feed via PumpPortal public WebSocket.
// No Redis, no Solana RPC, no auth required.
// wss://pumpportal.fun/api/data — same source pumpkit tools use.
// Each mint event is enriched with SOL price + token metadata before emit.

import WebSocket from 'ws';

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECTS = 5;
const META_TIMEOUT_MS = 2_500;
const SOL_PRICE_TTL_MS = 60_000;

// SOL price cache — one CoinGecko call per minute, shared across connections
let _solPrice = 0;
let _solPriceAt = 0;

async function getSolPrice() {
	if (Date.now() - _solPriceAt < SOL_PRICE_TTL_MS && _solPrice > 0) return _solPrice;
	try {
		const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
		const d = await r.json();
		const p = d?.solana?.usd;
		if (p > 0) { _solPrice = p; _solPriceAt = Date.now(); }
	} catch {}
	return _solPrice || 150;
}

// Token metadata cache — avoids re-fetching the same URI on reconnects
const _metaCache = new Map();

async function fetchMeta(uri) {
	if (!uri) return null;
	if (_metaCache.has(uri)) return _metaCache.get(uri);
	try {
		const ctrl = new AbortController();
		const tid = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);
		const r = await fetch(uri, { signal: ctrl.signal });
		clearTimeout(tid);
		if (!r.ok) return null;
		const d = await r.json();
		const meta = {
			description: d.description || null,
			twitter: d.twitter || null,
			telegram: d.telegram || null,
			website: d.website || null,
		};
		if (_metaCache.size > 500) _metaCache.clear();
		_metaCache.set(uri, meta);
		return meta;
	} catch { return null; }
}

/**
 * Connect to the PumpPortal WebSocket and stream pump.fun events.
 * @param {{ onEvent: Function, signal?: AbortSignal, kind?: string }} opts
 * @returns {Function} stop
 */
export function connectPumpFunFeed({ onEvent, signal, kind = 'all' }) {
	let active = true;
	let ws = null;
	let reconnects = 0;
	let reconnectTimer = null;

	function stop() {
		active = false;
		clearTimeout(reconnectTimer);
		if (ws) try { ws.close(); } catch {}
	}

	signal?.addEventListener('abort', stop);

	function connect() {
		if (!active) return;
		ws = new WebSocket(PUMPPORTAL_WS);

		ws.on('open', () => {
			reconnects = 0;
			if (kind === 'all' || kind === 'mint') {
				ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
			}
			if (kind === 'all' || kind === 'graduation') {
				ws.send(JSON.stringify({ method: 'subscribeMigration' }));
			}
		});

		ws.on('message', (raw) => {
			if (!active) return;
			let msg;
			try { msg = JSON.parse(raw.toString()); } catch { return; }
			if (msg.message) return; // ack

			if (msg.txType === 'create' && (kind === 'all' || kind === 'mint')) {
				enrichMint(msg).then((data) => {
					if (active) onEvent({ kind: 'mint', data });
				}).catch(() => {
					if (active) onEvent({ kind: 'mint', data: normalizeMint(msg, null, 0) });
				});
			} else if ((msg.txType === 'migrate' || msg.txType === 'migration') && (kind === 'all' || kind === 'graduation')) {
				enrichGrad(msg).then((data) => {
					if (active) onEvent({ kind: 'graduation', data });
				}).catch(() => {
					if (active) onEvent({ kind: 'graduation', data: normalizeGrad(msg) });
				});
			}
		});

		ws.on('error', (err) => console.warn('[pumpportal-ws] error:', err?.message));

		ws.on('close', () => {
			if (!active || reconnects >= MAX_RECONNECTS) return;
			reconnects++;
			reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
		});
	}

	connect();
	return stop;
}

async function enrichMint(d) {
	const [solPrice, meta] = await Promise.all([
		getSolPrice(),
		fetchMeta(d.uri),
	]);
	return normalizeMint(d, meta, solPrice);
}

function normalizeMint(d, meta, solPrice) {
	const mcSol = d.marketCapSol ?? 0;
	return {
		mint: d.mint,
		name: d.name,
		symbol: d.symbol,
		creator: d.traderPublicKey,
		signature: d.signature,
		market_cap_sol: mcSol,
		market_cap_usd: solPrice > 0 ? mcSol * solPrice : null,
		initial_buy_sol: d.solAmount ?? null,
		initial_buy_usd: solPrice > 0 && d.solAmount ? d.solAmount * solPrice : null,
		sol_price: solPrice,
		bonding_curve: d.bondingCurveKey,
		image_uri: d.uri,
		description: meta?.description || null,
		twitter: meta?.twitter || null,
		telegram: meta?.telegram || null,
		website: meta?.website || null,
		created_at: Math.floor(Date.now() / 1000),
	};
}

function normalizeGrad(d) {
	return {
		tx_signature: d.signature,
		signature: d.signature,
		mint: d.mint,
		name: d.name,
		symbol: d.symbol,
		pool: d.pool,
		timestamp: Math.floor(Date.now() / 1000),
	};
}

// ── graduation enrichment ────────────────────────────────────────────────────
//
// PumpPortal's migration message only carries {signature, mint, name, symbol,
// pool}. To render a rich card matching the desired feed format we resolve:
//   - coin metadata: usd_market_cap, market_cap_at_launch, created_timestamp,
//     description, creator from pump.fun's frontend coin endpoint
//   - creator history: total launches + best-token by market cap by listing
//     the creator's coins
// A short pump.fun coin TTL cache prevents hammering the endpoint when a
// migration shows up multiple times across reconnects, and per-fetch timeouts
// keep stalls bounded so a slow upstream can't pin the SSE worker.

const PUMPFUN_COIN_API = 'https://frontend-api-v3.pump.fun/coins';
const PUMPFUN_USER_COINS_API = 'https://frontend-api-v3.pump.fun/coins/user-created-coins';
const ENRICH_TIMEOUT_MS = 2_500;
const COIN_CACHE_TTL_MS = 30_000;
const _coinCache = new Map();
const _creatorCache = new Map();

async function fetchJsonWithTimeout(url, ms = ENRICH_TIMEOUT_MS) {
	const ctrl = new AbortController();
	const tid = setTimeout(() => ctrl.abort(), ms);
	try {
		const r = await fetch(url, {
			signal: ctrl.signal,
			headers: { 'accept': 'application/json', 'user-agent': 'three.ws-pumpfun-feed/1' },
		});
		if (!r.ok) return null;
		return await r.json();
	} catch { return null; } finally { clearTimeout(tid); }
}

async function fetchCoin(mint) {
	const hit = _coinCache.get(mint);
	if (hit && Date.now() - hit.t < COIN_CACHE_TTL_MS) return hit.v;
	const v = await fetchJsonWithTimeout(`${PUMPFUN_COIN_API}/${encodeURIComponent(mint)}`);
	if (_coinCache.size > 500) _coinCache.clear();
	_coinCache.set(mint, { t: Date.now(), v });
	return v;
}

async function fetchCreatorCoins(creator) {
	if (!creator) return null;
	const hit = _creatorCache.get(creator);
	if (hit && Date.now() - hit.t < COIN_CACHE_TTL_MS) return hit.v;
	const v = await fetchJsonWithTimeout(
		`${PUMPFUN_USER_COINS_API}/${encodeURIComponent(creator)}?offset=0&limit=50&includeNsfw=true`,
	);
	if (_creatorCache.size > 500) _creatorCache.clear();
	_creatorCache.set(creator, { t: Date.now(), v });
	return v;
}

function formatAge(createdAtMs) {
	if (!createdAtMs) return '';
	const s = Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000));
	if (s < 60) return s + 's';
	const m = Math.floor(s / 60);
	if (m < 60) return m + 'm';
	const h = Math.floor(m / 60);
	if (h < 24) return h + 'h';
	return Math.floor(h / 24) + 'd';
}

async function enrichGrad(d) {
	const base = normalizeGrad(d);
	const mint = d.mint;
	if (!mint) return base;

	const [solPrice, coin] = await Promise.all([
		getSolPrice(),
		fetchCoin(mint),
	]);

	if (!coin) return base;

	const creator = coin.creator || d.traderPublicKey || null;
	const userCoins = creator ? await fetchCreatorCoins(creator) : null;

	const usdMc = typeof coin.usd_market_cap === 'number' ? coin.usd_market_cap : null;
	const launchSol = typeof coin.market_cap_at_launch === 'number' ? coin.market_cap_at_launch : null;
	const launchUsd = launchSol != null && solPrice > 0 ? launchSol * solPrice : null;

	const createdMs = coin.created_timestamp ? Number(coin.created_timestamp) : null;
	const age = formatAge(createdMs);

	let creatorTokens = [];
	let launches = null;
	if (Array.isArray(userCoins)) {
		launches = userCoins.length;
		creatorTokens = userCoins
			.map((c) => ({
				mint: c.mint,
				symbol: c.symbol,
				name: c.name,
				mc: typeof c.usd_market_cap === 'number'
					? c.usd_market_cap
					: (typeof c.market_cap === 'number' && solPrice > 0 ? c.market_cap * solPrice : null),
			}))
			.filter((c) => c.symbol);
	}

	const amountSol = typeof d.solAmount === 'number' ? d.solAmount
		: typeof coin.virtual_sol_reserves === 'number' && coin.virtual_sol_reserves > 0
			? coin.virtual_sol_reserves / 1e9
			: null;
	const amountUsd = amountSol != null && solPrice > 0 ? amountSol * solPrice : null;

	return {
		...base,
		name: coin.name || base.name,
		symbol: coin.symbol || base.symbol,
		description: coin.description || null,
		creator,
		image_uri: coin.image_uri || null,
		twitter: coin.twitter || null,
		telegram: coin.telegram || null,
		website: coin.website || null,
		usd_market_cap: usdMc,
		market_cap: usdMc,
		market_cap_usd_initial: launchUsd,
		market_cap_at_launch: launchSol,
		sol_price: solPrice || null,
		created_at: createdMs ? Math.floor(createdMs / 1000) : null,
		age,
		amount_sol: amountSol,
		amount_usd: amountUsd,
		creator_launches: launches,
		creator_tokens: creatorTokens,
	};
}
