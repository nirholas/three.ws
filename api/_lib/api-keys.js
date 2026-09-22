// API key scopes and minting, shared by every surface that issues a key:
// /api/keys (the dashboard), /api/api-keys (the legacy route), and the CLI
// device link (/api/cli/token). Each route used to carry its own copy of the
// scope set, so a scope added for one surface was silently refused by another.

import { sql } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { logAudit } from './audit.js';

// The wallet and services scopes gate the agent-wallet MCP server
// (api/mcp-agent). A key carrying them is bounded exactly like an OAuth token
// carrying them: every spend still passes the server-side caps and
// THREEWS_AGENT_PAY_ENABLED, so a key is never a wider grant than consent.
export const API_KEY_SCOPES = Object.freeze([
	'avatars:read',
	'avatars:write',
	'avatars:delete',
	'profile',
	'memory:read',
	'memory:write',
	'agents:read',
	'agents:write',
	'herald:announce',
	'wallet:read',
	'wallet:write',
	'services:write',
	// Model calls on the OpenAI-compatible endpoint (/api/v1/chat/completions),
	// billed to the account's credits. Keys minted by /api/me/inference/provision
	// carry this scope alone, so a leaked inference key can spend credits on
	// model calls and nothing else: no wallet, no agents, no profile.
	'inference',
]);

const ALLOWED = new Set(API_KEY_SCOPES);

/**
 * Split, dedupe and validate a space-separated scope string.
 * @returns {{ scopes: string[], invalid: string[] }}
 */
export function normalizeKeyScopes(scope) {
	const scopes = [...new Set(String(scope || '').split(/\s+/).filter(Boolean))];
	return { scopes, invalid: scopes.filter((s) => !ALLOWED.has(s)) };
}

/**
 * Insert a new API key and return its row plus the plaintext secret. The secret
 * is never stored; only its sha256 is. Callers validate scopes first.
 */
export async function mintApiKey({ userId, name, scopes, expiresAt = null, environment = 'live', req = null, via = 'dashboard' }) {
	const raw = `sk_${environment}_${randomToken(28)}`;
	const hash = await sha256(raw);
	const prefix = raw.slice(0, 12);
	const [row] = await sql`
		insert into api_keys (user_id, name, prefix, token_hash, scope, expires_at)
		values (${userId}, ${name}, ${prefix}, ${hash}, ${scopes.join(' ')}, ${expiresAt})
		returning id, name, prefix, scope, expires_at, created_at
	`;
	// Never the secret or its hash, only the id, prefix, and granted scope.
	logAudit({
		userId,
		action: 'create_api_key',
		resourceId: row.id,
		meta: { prefix, scope: row.scope, environment, via },
		req,
	});
	return { row, secret: raw };
}
