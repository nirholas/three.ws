// Inline embed-policy helpers (api/_lib/embed-policy.js not yet shipped).
import { sql } from '../_lib/db.js';

function _mcpDefaultPolicy() {
	return {
		version: 1,
		origins: { mode: 'allowlist', hosts: [] },
		surfaces: { script: true, iframe: true, widget: true, mcp: true },
	};
}

function _mcpParsePolicy(p) {
	if (!p) return null;
	if (!('version' in p) && ('mode' in p || 'hosts' in p)) {
		// Old flat shape — only origins were configured; all surfaces (incl. mcp) allowed.
		return {
			..._mcpDefaultPolicy(),
			origins: { mode: p.mode || 'allowlist', hosts: p.hosts ?? [] },
		};
	}
	return { ..._mcpDefaultPolicy(), ...p };
}

export async function readMcpPolicyByAvatar(avatarId) {
	try {
		const [row] = await sql`
			SELECT embed_policy FROM agent_identities
			WHERE avatar_id = ${avatarId} AND deleted_at IS NULL
			LIMIT 1
		`;
		if (!row) return null;
		return _mcpParsePolicy(row.embed_policy);
	} catch (err) {
		if (/column .* does not exist/i.test(String(err?.message))) return null;
		throw err;
	}
}
