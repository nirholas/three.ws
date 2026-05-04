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
					pushBuffer('mint', data);
					if (active) onEvent({ kind: 'mint', data });
				}).catch(() => {
					const data = normalizeMint(msg, null, 0);
					pushBuffer('mint', data);
					if (active) onEvent({ kind: 'mint', data });
				});
			} else if ((msg.txType === 'migrate' || msg.txType === 'migration') && (kind === 'all' || kind === 'graduation')) {
				enrichGrad(msg).then((data) => {
					pushBuffer('graduation', data);
					if (active) onEvent({ kind: 'graduation', data });
				}).catch(() => {
					const data = normalizeGrad(msg);
					pushBuffer('graduation', data);
					if (active) onEvent({ kind: 'graduation', data });
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

function pickMc(c, solPrice) {
	if (typeof c?.usd_market_cap === 'number') return c.usd_market_cap;
	if (typeof c?.market_cap === 'number' && solPrice > 0) return c.market_cap * solPrice;
	return null;
}

function isGraduated(c) {
	return c?.complete === true || !!c?.raydium_pool || !!c?.pump_swap_pool;
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

	const usdMc = pickMc(coin, solPrice);
	const launchSol = typeof coin.market_cap_at_launch === 'number' ? coin.market_cap_at_launch : null;
	const launchUsd = launchSol != null && solPrice > 0 ? launchSol * solPrice : null;

	// ATH: pump.fun frontend exposes ath_market_cap (USD) on some mints; fall
	// back to current MC as a floor so the renderer always has a value.
	const athUsd = typeof coin.ath_market_cap === 'number' ? coin.ath_market_cap
		: typeof coin.ath_market_cap_usd === 'number' ? coin.ath_market_cap_usd
		: usdMc;

	const createdMs = coin.created_timestamp ? Number(coin.created_timestamp) : null;
	const age = formatAge(createdMs);

	let creatorTokens = [];
	let launches = null;
	let creatorGraduated = null;
	if (Array.isArray(userCoins)) {
		launches = userCoins.length;
		creatorGraduated = userCoins.reduce((n, c) => n + (isGraduated(c) ? 1 : 0), 0);
		creatorTokens = userCoins
			.map((c) => ({
				mint: c.mint,
				symbol: c.symbol,
				name: c.name,
				mc: pickMc(c, solPrice),
				graduated: isGraduated(c),
			}))
			.filter((c) => c.symbol);
	}

	// Migration `solAmount` is the most accurate "graduation deposit" number.
	// If absent (PumpPortal sometimes omits), fall back to the real_sol_reserves
	// at graduation (≈ 85 SOL bonding-curve floor).
	const amountSol = typeof d.solAmount === 'number' ? d.solAmount
		: typeof coin.real_sol_reserves === 'number' && coin.real_sol_reserves > 0
			? coin.real_sol_reserves / 1e9
			: null;
	const amountUsd = amountSol != null && solPrice > 0 ? amountSol * solPrice : null;

	const graduated = isGraduated(coin);
	const raydiumPool = coin.raydium_pool || null;
	const pumpSwapPool = coin.pump_swap_pool || null;

	return {
		...base,
		name: coin.name || base.name,
		symbol: coin.symbol || base.symbol,
		description: coin.description || null,
		creator,
		creator_username: coin.username || null,
		creator_profile_image: coin.profile_image || null,
		image_uri: coin.image_uri || null,
		video_uri: coin.video_uri || null,
		twitter: coin.twitter || null,
		telegram: coin.telegram || null,
		website: coin.website || null,
		usd_market_cap: usdMc,
		market_cap: usdMc,
		market_cap_usd_initial: launchUsd,
		market_cap_at_launch: launchSol,
		ath_market_cap: athUsd,
		sol_price: solPrice || null,
		created_at: createdMs ? Math.floor(createdMs / 1000) : null,
		age,
		amount_sol: amountSol,
		amount_usd: amountUsd,
		bonding_curve_pct: 100,
		complete: graduated,
		raydium_pool: raydiumPool,
		pump_swap_pool: pumpSwapPool,
		reply_count: typeof coin.reply_count === 'number' ? coin.reply_count : null,
		creator_launches: launches,
		creator_graduated: creatorGraduated,
		creator_tokens: creatorTokens,
	};
}

// ── Process-local replay buffer ──────────────────────────────────────────────
//
// The PumpPortal WS connection is shared per Vercel instance. We keep a small
// rolling buffer of the most-recent enriched mint and graduation events so each
// new SSE client (which would otherwise see a blank feed until the next event)
// can immediately render a contextual backlog. Buffered events are emitted with
// a `replay: true` marker so the UI can dim them.

const BUFFER_LIMIT = { mint: 25, graduation: 25 };
const _buffer = { mint: [], graduation: [] };

function pushBuffer(kind, data) {
	const arr = _buffer[kind];
	if (!arr) return;
	const sig = data?.signature || data?.tx_signature;
	if (sig && arr.some((e) => (e.signature || e.tx_signature) === sig)) return;
	arr.unshift(data);
	while (arr.length > BUFFER_LIMIT[kind]) arr.pop();
}

/**
 * Snapshot of recently buffered events, newest-first. Caller filters by kind.
 * @param {{ kind?: 'all'|'mint'|'graduation'|'claims', limit?: number }} opts
 */
export function recentBuffered({ kind = 'all', limit = 10 } = {}) {
	const out = [];
	if (kind === 'all' || kind === 'mint') {
		for (const data of _buffer.mint.slice(0, limit)) out.push({ kind: 'mint', data });
	}
	if (kind === 'all' || kind === 'graduation' || kind === 'claims') {
		for (const data of _buffer.graduation.slice(0, limit)) out.push({ kind: 'graduation', data });
	}
	// Sort by timestamp/created_at descending so a multi-kind replay is interleaved.
	out.sort((a, b) => {
		const ta = a.data.timestamp || a.data.created_at || 0;
		const tb = b.data.timestamp || b.data.created_at || 0;
		return tb - ta;
	});
	return out.slice(0, limit);
}
