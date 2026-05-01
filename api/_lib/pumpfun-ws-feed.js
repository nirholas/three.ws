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
				onEvent({ kind: 'graduation', data: normalizeGrad(msg) });
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
	};
}
