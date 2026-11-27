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
//
// A key the caller supplied (inline, or one saved on their account) that cannot
// be a real key, or a saved key that cannot be read, is REJECTED, never skipped:
// resolution stops there and reports `rejected`, so the request is refused
// instead of quietly running on the platform's house key at the platform's cost.

import { getSessionUser } from './auth.js';
import { sql } from './db.js';
import { loadUserProviderKeys } from './provider-keys.js';
import { keyShapeProblem } from './forge-byok-guard.js';

// Providers with a platform (house) key lane, mapped to the env var that
// carries it. Absent here, or unset in the environment, a provider behaves
// exactly as it always has: user-supplied keys only.
const HOUSE_KEY_ENV = {
	tripo: 'TRIPO_API_KEY',
};

// The caller's own key only (inline, then saved), never the house key, with
// `rejected` set when what they supplied cannot be used. For surfaces that have
// no house lane (the GPT clone, the 3D Studio tools).
export async function resolveCallerProviderKey(req, body, providerName) {
	return resolveInlineOrUserKey(req, body, providerName);
}

async function resolveInlineOrUserKey(req, body, providerName) {
	const header = req.headers['x-forge-provider-key'];
	const inline =
		(typeof header === 'string' && header) ||
		(Array.isArray(header) && header[0]) ||
		(typeof body?.provider_key === 'string' ? body.provider_key : '');
	if (inline && inline.trim()) {
		const key = inline.trim();
		const problem = keyShapeProblem(providerName, key);
		if (problem) return { key: null, source: null, rejected: { ...problem, from: 'inline' } };
		return { key, source: 'inline' };
	}

	let session = null;
	try {
		session = await getSessionUser(req);
	} catch {
		// No session cookie, nothing stored to read: "no key".
	}
	if (!session?.id) return { key: null, source: null };

	let stored;
	try {
		const [row] = await sql`SELECT provider_keys FROM users WHERE id = ${session.id}`;
		stored = row?.provider_keys;
	} catch {
		return {
			key: null,
			source: null,
			rejected: {
				reason: 'stored_unreadable',
				from: 'user',
				message: 'Your saved key could not be read just now. Try again in a moment, or paste the key for this request.',
			},
		};
	}
	if (stored && typeof stored === 'object' && typeof stored[providerName] === 'string' && stored[providerName]) {
		const keys = await loadUserProviderKeys(stored);
		const key = keys[providerName];
		if (!key) {
			return {
				key: null,
				source: null,
				rejected: {
					reason: 'stored_unreadable',
					from: 'user',
					message: 'Your saved key could not be read. Remove it on your Account page and paste it again.',
				},
			};
		}
		const problem = keyShapeProblem(providerName, key);
		if (problem) return { key: null, source: null, rejected: { ...problem, from: 'user' } };
		return { key, source: 'user' };
	}
	return { key: null, source: null };
}

// Same priority order as resolveProviderKey, plus a `source` tag so callers
// that bill differently per source (forge.js's house-key credits gate) can
// tell a user's own key apart from the platform's.
export async function resolveProviderKeyWithSource(req, body, providerName) {
	const found = await resolveInlineOrUserKey(req, body, providerName);
	if (found.key || found.rejected) return found;

	const envVar = HOUSE_KEY_ENV[providerName];
	const houseKey = envVar ? process.env[envVar] : null;
	if (houseKey) return { key: houseKey, source: 'house' };

	return { key: null, source: null };
}

export async function resolveProviderKey(req, body, providerName) {
	const { key } = await resolveInlineOrUserKey(req, body, providerName);
	return key;
}

// The unattended twin of resolveProviderKeyWithSource, for a job whose page is
// gone (api/cron/forge-finalize.js). There is no request, so no inline key: an
// inline key is used for one request and never stored, so a job submitted with
// one can only finish while its page is open. What remains is the owner's
// stored key, then the provider's house key, in that order.
export async function resolveStoredProviderKey({ userId, provider }) {
	if (userId) {
		try {
			const [row] = await sql`SELECT provider_keys FROM users WHERE id = ${userId}`;
			const keys = await loadUserProviderKeys(row?.provider_keys);
			if (keys[provider]) return keys[provider];
		} catch {
			// No DB or an undecryptable store: fall through to the house key.
		}
	}
	const envVar = HOUSE_KEY_ENV[provider];
	return (envVar && process.env[envVar]) || null;
}
