// BYOK key resolution for the geometry generation providers (Meshy / Tripo),
// shared by the /api/forge endpoint and the 3D Studio MCP server (/api/mcp-3d).
//
// Most of these backends have no platform key: the key must come from the
// caller. Three possible sources, in priority order:
//   1. An inline key on the request, header `x-forge-provider-key` (preferred,
//      kept out of URLs/logs) or `provider_key` in the POST body. Used
//      transiently and never persisted.
//   2. The signed-in user's stored, encrypted key (the dashboard BYOK store),
//      when the request carries a session cookie.
//   3. A house key: for the one provider configured in HOUSE_KEY_ENV (Tripo),
//      the platform's own env-var key, billed through our credits like any
//      other house lane. Checked last so a user's own key always wins.
// resolveProviderKey returns the plaintext key or null when none is available.

import { getSessionUser } from './auth.js';
import { sql } from './db.js';
import { loadUserProviderKeys } from './provider-keys.js';

// Providers with a platform (house) key lane, mapped to the env var that
// carries it. Absent here, or unset in the environment, a provider behaves
// exactly as it always has: user-supplied keys only.
const HOUSE_KEY_ENV = {
	tripo: 'TRIPO_API_KEY',
};

async function resolveInlineOrUserKey(req, body, providerName) {
	const header = req.headers['x-forge-provider-key'];
	const inline =
		(typeof header === 'string' && header) ||
		(Array.isArray(header) && header[0]) ||
		(typeof body?.provider_key === 'string' ? body.provider_key : '');
	if (inline && inline.trim()) return { key: inline.trim(), source: 'inline' };

	try {
		const session = await getSessionUser(req);
		if (session?.id) {
			const [row] = await sql`SELECT provider_keys FROM users WHERE id = ${session.id}`;
			const keys = await loadUserProviderKeys(row?.provider_keys);
			if (keys[providerName]) return { key: keys[providerName], source: 'user' };
		}
	} catch {
		// No DB / no session, fall through to "no key".
	}
	return { key: null, source: null };
}

// Same priority order as resolveProviderKey, plus a `source` tag so callers
// that bill differently per source (forge.js's house-key credits gate) can
// tell a user's own key apart from the platform's.
export async function resolveProviderKeyWithSource(req, body, providerName) {
	const found = await resolveInlineOrUserKey(req, body, providerName);
	if (found.key) return found;

	const envVar = HOUSE_KEY_ENV[providerName];
	const houseKey = envVar ? process.env[envVar] : null;
	if (houseKey) return { key: houseKey, source: 'house' };

	return { key: null, source: null };
}

export async function resolveProviderKey(req, body, providerName) {
	const { key } = await resolveInlineOrUserKey(req, body, providerName);
	return key;
}
