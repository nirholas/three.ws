// Real-time Solana wallet monitor for pump.fun trades.
// Uses Solana WebSocket logsSubscribe to detect buys/sells from a target wallet
// with ~100ms latency instead of the 5s poll used by pumpfun-copy-trade.
//
// Emits a 'trade' event on every confirmed pump.fun instruction:
//   { side: 'buy'|'sell', mint: string, solAmount: number, signature: string }
//
// Auto-reconnects with exponential backoff on disconnect.

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

const WS_URLS = {
	mainnet: 'wss://api.mainnet-beta.solana.com',
	devnet: 'wss://api.devnet.solana.com',
};

// Parse pump.fun structured log line: "Program log: {...json...}"
function extractLogJson(log) {
	if (!log.startsWith('Program log: {')) return null;
	try { return JSON.parse(log.slice('Program log: '.length)); } catch { return null; }
}

// Returns { side, mint, solAmount } or null if not a pump.fun trade.
function parseTradeFromLogs(logs) {
	const isPump = logs.some((l) => l.includes(PUMP_PROGRAM) || l.includes(PUMP_AMM_PROGRAM));
	if (!isPump) return null;

	const isBuy = logs.some((l) => l.includes('Instruction: Buy'));
	const isSell = logs.some((l) => l.includes('Instruction: Sell'));
	if (!isBuy && !isSell) return null;

	let mint = null;
	let solAmount = 0;

	for (const log of logs) {
		const data = extractLogJson(log);
		if (!data) continue;
		if (data.mint) mint = data.mint;
		// quote_amount is lamports on the bonding curve; sol_amount on some AMM paths
		const raw = data.quote_amount ?? data.sol_amount;
		if (raw != null) solAmount = Number(raw) / 1e9;
	}

	if (!mint) return null;
	return { side: isBuy ? 'buy' : 'sell', mint, solAmount };
}

export class WalletMonitor extends EventTarget {
	/**
	 * @param {string} wallet  — base58 Solana address to watch
	 * @param {{ network?: 'mainnet'|'devnet', wsUrl?: string }} opts
	 */
	constructor(wallet, { network = 'mainnet', wsUrl } = {}) {
		super();
		this.wallet = wallet;
		this._wsUrl = wsUrl ?? WS_URLS[network] ?? WS_URLS.mainnet;
		this._ws = null;
		this._subId = null;
		this._msgId = 0;
		this._closed = false;
		this._reconnectMs = 1000;
	}

	start() {
		this._closed = false;
		this._connect();
	}

	stop() {
		this._closed = true;
		this._ws?.close();
		this._ws = null;
	}

	_connect() {
		if (this._closed) return;

		const ws = new WebSocket(this._wsUrl);
		this._ws = ws;

		ws.onopen = () => {
			this._reconnectMs = 1000;
			ws.send(JSON.stringify({
				jsonrpc: '2.0',
				id: ++this._msgId,
				method: 'logsSubscribe',
				params: [
					{ mentions: [this.wallet] },
					{ commitment: 'confirmed' },
				],
			}));
		};

		ws.onmessage = ({ data }) => {
			let msg;
			try { msg = JSON.parse(data); } catch { return; }

			// Subscription confirmation
			if (msg.id != null && typeof msg.result === 'number') {
				this._subId = msg.result;
				return;
			}

			// Log notification
			const value = msg?.params?.result?.value;
			if (!value) return;
			const { logs, signature, err } = value;
			if (err || !Array.isArray(logs) || logs.length === 0) return;

			const trade = parseTradeFromLogs(logs);
			if (!trade) return;

			const evt = new Event('trade');
			Object.assign(evt, { ...trade, signature });
			this.dispatchEvent(evt);
		};

		ws.onerror = () => {};

		ws.onclose = () => {
			this._ws = null;
			if (!this._closed) {
				setTimeout(() => this._connect(), this._reconnectMs);
				this._reconnectMs = Math.min(this._reconnectMs * 2, 30_000);
			}
		};
	}
}
