// Pump.fun public WebSocket feed — no Redis or Solana RPC required.
// Uses pump.fun's Socket.IO endpoint for live mint events and polls
// their REST API for graduation (migration) events.

import WebSocket from 'ws';

const PUMP_WS = 'wss://frontend-api.pump.fun/socket.io/?EIO=4&transport=websocket';
const PUMP_REST = 'https://frontend-api.pump.fun';
const GRAD_POLL_MS = 5_000;

/**
 * Connect to the pump.fun public feed.
 * @param {{ onEvent: Function, signal?: AbortSignal, kind?: string }} opts
 *   kind: 'all' | 'mint' | 'graduation'  (default 'all')
 *   onEvent: ({ kind, data }) => void
 * @returns {Function} cleanup — call to stop everything early
 */
export function connectPumpFunFeed({ onEvent, signal, kind = 'all' }) {
	let active = true;
	let ws = null;
	let pollTimer = null;
	const seenGrad = new Set();

	function stop() {
		active = false;
		clearTimeout(pollTimer);
		if (ws) try { ws.close(); } catch {}
	}

	signal?.addEventListener('abort', stop);

	// Socket.IO WebSocket for real-time mint events
	if (kind === 'all' || kind === 'mint') {
		ws = new WebSocket(PUMP_WS, {
			headers: { Origin: 'https://pump.fun', 'User-Agent': 'Mozilla/5.0' },
		});

		ws.on('open', () => {
			ws.send('40'); // Engine.IO → Socket.IO connect
		});

		ws.on('message', (raw) => {
			if (!active) return;
			const str = raw.toString();

			if (str === '2') { ws.send('3'); return; } // ping → pong

			if (str.startsWith('40')) {
				// Socket.IO connected — subscribe to new tokens
				ws.send('42["subscribeNewToken"]');
				return;
			}

			if (!str.startsWith('42')) return;
			let msg;
			try { msg = JSON.parse(str.slice(2)); } catch { return; }
			const [event, data] = msg;

			if (event === 'newCoinCreated' && data?.mint) {
				onEvent({ kind: 'mint', data: normalizeMint(data) });
			}
		});

		ws.on('error', (err) => console.error('[pumpfun-ws] error:', err?.message));
	}

	// REST polling for graduations (pump.fun doesn't emit these on Socket.IO)
	if (kind === 'all' || kind === 'graduation') {
		const pollGrads = async () => {
			if (!active) return;
			try {
				const r = await fetch(`${PUMP_REST}/coins/migrated?limit=20`, {
					headers: { 'User-Agent': 'Mozilla/5.0' },
					signal: signal ?? undefined,
				});
				if (r.ok) {
					const coins = await r.json();
					const list = Array.isArray(coins) ? coins : (coins?.coins ?? []);
					for (const coin of list) {
						const id = coin.tx_hash || coin.mint;
						if (seenGrad.has(id)) continue;
						seenGrad.add(id);
						if (seenGrad.size > 500) {
							const oldest = seenGrad.values().next().value;
							seenGrad.delete(oldest);
						}
						onEvent({ kind: 'graduation', data: normalizeGrad(coin) });
					}
				}
			} catch {}
			if (active) pollTimer = setTimeout(pollGrads, GRAD_POLL_MS);
		};
		pollGrads();
	}

	return stop;
}

function normalizeMint(d) {
	return {
		mint: d.mint,
		name: d.name,
		symbol: d.symbol,
		image_uri: d.image_uri,
		creator: d.creator,
		created_timestamp: d.created_timestamp,
		usd_market_cap: d.usd_market_cap,
		description: d.description,
	};
}

function normalizeGrad(d) {
	return {
		tx_signature: d.tx_hash || null,
		signature: d.tx_hash || null,
		mint: d.mint,
		name: d.name,
		symbol: d.symbol,
		usd_market_cap: d.usd_market_cap,
		raydium_pool: d.raydium_pool,
	};
}
