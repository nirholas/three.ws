// Pump.fun live feed via PumpPortal public WebSocket.
// No Redis, no Solana RPC, no auth required.
// wss://pumpportal.fun/api/data — same source pumpkit tools use.

import WebSocket from 'ws';

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECTS = 5;

/**
 * Connect to the PumpPortal WebSocket and stream pump.fun events.
 * @param {{ onEvent: Function, signal?: AbortSignal, kind?: string }} opts
 *   kind: 'all' | 'mint' | 'graduation'
 *   onEvent: ({ kind, data }) => void
 * @returns {Function} stop — call to clean up
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
			// Subscribe based on requested kind
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

			// Skip subscription acks
			if (msg.message) return;

			if (msg.txType === 'create') {
				if (kind === 'all' || kind === 'mint') {
					onEvent({ kind: 'mint', data: normalizeMint(msg) });
				}
			} else if (msg.txType === 'migrate' || msg.txType === 'migration') {
				if (kind === 'all' || kind === 'graduation') {
					onEvent({ kind: 'graduation', data: normalizeGrad(msg) });
				}
			}
		});

		ws.on('error', (err) => console.error('[pumpportal-ws] error:', err?.message));

		ws.on('close', () => {
			if (!active) return;
			if (reconnects >= MAX_RECONNECTS) return;
			reconnects++;
			reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
		});
	}

	connect();
	return stop;
}

function normalizeMint(d) {
	return {
		mint: d.mint,
		name: d.name,
		symbol: d.symbol,
		creator: d.traderPublicKey,
		signature: d.signature,
		market_cap_sol: d.marketCapSol,
		image_uri: d.uri,
		bonding_curve: d.bondingCurveKey,
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
