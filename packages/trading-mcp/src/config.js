// Centralized env + HTTP base for the trading MCP.
//
// This server quotes and fills real Solana swaps from the caller's three.ws
// agent wallet over live HTTP. Every route is owner-scoped, so the server is
// authenticated: it carries a three.ws API key (or OAuth access token) as a
// Bearer credential. It signs nothing locally; the per-trade cap, daily
// budget, price-impact breaker, rug firewall and kill switch all run
// server-side in the same executor the wallet hub uses.

export function env(key, fallback) {
	const v = process.env[key];
	return v !== undefined && String(v).trim() !== '' ? String(v).trim() : fallback;
}

export const THREE_WS_BASE = env('THREE_WS_BASE', 'https://three.ws').replace(/\/+$/, '');

// REQUIRED. A key that can fill a trade needs the wallet:trade grant; a key
// without it can still quote and read positions.
export const THREE_WS_API_KEY =
	env('THREE_WS_API_KEY') || env('THREE_WS_TOKEN') || env('THREE_WS_BEARER') || '';

export const HTTP_TIMEOUT_MS = (() => {
	const raw = env('THREE_WS_TIMEOUT_MS');
	if (raw === undefined) return 60000;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw Object.assign(new Error(`THREE_WS_TIMEOUT_MS must be a positive number (got "${raw}")`), {
			code: 'bad_config',
		});
	}
	return n;
})();

export const USER_AGENT = '@three-ws/trading-mcp';

// $THREE is buy-and-hold only for an agent. A sell of it is refused here so the
// call never leaves the process, and Autopilot refuses it as a trade kind too.
export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
