// Centralized env + HTTP base for the agent-trader MCP.
//
// This server arms agents on the Oracle and reads what they did. Arming and the
// guardrails are owner-only, so it carries a three.ws API key (or OAuth access
// token) as a Bearer credential. It signs nothing locally; every scope, spend
// cap and the real-funds agreement are enforced server-side.

export function env(key, fallback) {
	const v = process.env[key];
	return v !== undefined && String(v).trim() !== '' ? String(v).trim() : fallback;
}

// Base URL of the three.ws API. Override only when self-hosting or pointing at a
// preview deployment.
export const THREE_WS_BASE = env('THREE_WS_BASE', 'https://three.ws').replace(/\/+$/, '');

// The agent's three.ws credential. Either a three.ws API key (sk_live_… /
// sk_test_…) or an OAuth access token, both authenticate as the owning user via
// `Authorization: Bearer`. REQUIRED: every agent-trader endpoint is owner-scoped and
// returns 401 without it. Treat it like a password; it can move real SOL.
export const THREE_WS_API_KEY =
	env('THREE_WS_API_KEY') || env('THREE_WS_TOKEN') || env('THREE_WS_BEARER') || '';

// Per-request timeout (ms). Arming and reading are quick, but a cold edge can be slow, so
// the default is generous.
export const HTTP_TIMEOUT_MS = (() => {
	const raw = env('THREE_WS_TIMEOUT_MS');
	if (raw === undefined) return 30000;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw Object.assign(new Error(`THREE_WS_TIMEOUT_MS must be a positive number (got "${raw}")`), {
			code: 'bad_config',
		});
	}
	return n;
})();

// Identifies this client to the API in request logs.
export const USER_AGENT = '@three-ws/agent-trader-mcp';
