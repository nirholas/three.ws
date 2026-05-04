// Client for the upstream pumpfun-claims-bot MCP server.
//
// Provides a small, typed surface over JSON-RPC tools/call:
//   recentClaims, claimsSince, graduations, tokenIntel, creatorIntel
//
// Falls back to ok:false envelopes (never throws) so callers can use the
// data when present and degrade gracefully when the indexer is offline or
// the env URL is not configured.
//
// Env:
//   PUMPFUN_BOT_URL    HTTP(S) endpoint of the MCP server (e.g. https://bot/mcp)
//   PUMPFUN_BOT_TOKEN  optional bearer token, attached as `Authorization: Bearer …`

let _id = 0;
function nextId() { return ++_id; }

export function pumpfunBotEnabled() {
	return !!process.env.PUMPFUN_BOT_URL;
}

async function rpcCall(toolName, args = {}) {
	const url = process.env.PUMPFUN_BOT_URL;
	if (!url) return { ok: false, error: 'PUMPFUN_BOT_URL not configured' };

	const headers = { 'content-type': 'application/json' };
	if (process.env.PUMPFUN_BOT_TOKEN) {
		headers.authorization = `Bearer ${process.env.PUMPFUN_BOT_TOKEN}`;
	}

	const body = JSON.stringify({
		jsonrpc: '2.0',
		id: nextId(),
		method: 'tools/call',
		params: { name: toolName, arguments: args },
	});

	let res;
	try {
		res = await fetch(url, { method: 'POST', headers, body });
	} catch (err) {
		return { ok: false, error: `pumpfun-mcp fetch failed: ${err?.message || err}` };
	}
	if (!res.ok) {
		return { ok: false, error: `pumpfun-mcp upstream ${res.status}` };
	}
	let envelope;
	try { envelope = await res.json(); }
	catch (err) { return { ok: false, error: `pumpfun-mcp invalid JSON: ${err?.message || err}` }; }

	if (envelope?.error) {
		return { ok: false, error: envelope.error.message || 'rpc error' };
	}
	const result = envelope?.result;
	const data = result?.structuredContent ?? result?.content ?? result ?? null;
	return { ok: true, data };
}

export const pumpfunMcp = {
	enabled: pumpfunBotEnabled,

	async listTools() {
		const url = process.env.PUMPFUN_BOT_URL;
		if (!url) return { ok: false, error: 'PUMPFUN_BOT_URL not configured' };
		const headers = { 'content-type': 'application/json' };
		if (process.env.PUMPFUN_BOT_TOKEN) headers.authorization = `Bearer ${process.env.PUMPFUN_BOT_TOKEN}`;
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify({ jsonrpc: '2.0', id: nextId(), method: 'tools/list' }),
			});
			if (!res.ok) return { ok: false, error: `pumpfun-mcp upstream ${res.status}` };
			const env = await res.json();
			if (env?.error) return { ok: false, error: env.error.message || 'rpc error' };
			return { ok: true, data: env.result };
		} catch (err) {
			return { ok: false, error: `pumpfun-mcp fetch failed: ${err?.message || err}` };
		}
	},

	async recentClaims({ limit } = {}) {
		const args = {};
		if (limit != null) args.limit = limit;
		return rpcCall('getRecentClaims', args);
	},

	async claimsSince({ sinceTs, limit } = {}) {
		const args = {};
		if (sinceTs != null) args.sinceTs = sinceTs;
		if (limit != null) args.limit = limit;
		return rpcCall('getClaimsSince', args);
	},

	async graduations({ limit } = {}) {
		const args = {};
		if (limit != null) args.limit = limit;
		return rpcCall('getGraduations', args);
	},

	async tokenIntel({ mint } = {}) {
		if (!mint) return { ok: false, error: 'mint is required' };
		return rpcCall('getTokenIntel', { mint });
	},

	async creatorIntel({ creator } = {}) {
		if (!creator) return { ok: false, error: 'creator is required' };
		return rpcCall('getCreatorIntel', { creator });
	},
};
