// Persistence and presentation for agent_mcp_connections.
//
// Two rules live here and nowhere else:
//   1. Credentials are written and read only as one secret-box ciphertext
//      (`credentials_enc`). A document is decrypted into memory for the length
//      of one operation and never leaves this module's callers in a response.
//   2. `presentConnection` is the only shape a connection takes on its way out
//      to a route, the CLI or an MCP tool. It is built field by field (an
//      allowlist), so a column added later is private until someone chooses to
//      expose it.

import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { encryptSecret, decryptSecret } from '../secret-box.js';
import { classifyTool, TIERS } from './classify.js';
import { getCatalogEntry } from './catalog.js';

export const MAX_CONNECTIONS_PER_AGENT = 25;

const cols = () => sql`id, agent_id, user_id, name, catalog_id, server_url, label, transport, auth_type, status,
	credentials_enc IS NOT NULL AS has_credentials, tools, tools_refreshed_at, server_info, enabled_tools,
	tier_overrides, acknowledged_tools, reviewed_at, last_error, last_used_at, token_expires_at,
	oauth_state_expires_at, created_at, updated_at`;

export const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
export const newState = () => randomBytes(32).toString('base64url');

/** The catalog rules for a connection, or null for a custom server. */
export function rulesFor(row) {
	return (row.catalog_id && getCatalogEntry(row.catalog_id)?.tiers) || null;
}

/** Effective tier of one stored tool on one connection. */
export function tierOf(row, tool) {
	return classifyTool(tool, { rules: rulesFor(row), overrides: row.tier_overrides || {} });
}

/** The tier a tool would have without the owner's override. */
export function defaultTierOf(row, tool) {
	return classifyTool(tool, { rules: rulesFor(row) }).tier;
}

/**
 * The public shape of a connection. Never includes credentials, the OAuth
 * state hash or the return path.
 */
export function presentConnection(row) {
	const enabled = new Set(row.enabled_tools || []);
	const acknowledged = new Set(row.acknowledged_tools || []);
	const tools = (row.tools || []).map((t) => {
		const { tier, source } = tierOf(row, t);
		return {
			name: t.name,
			title: t.title || null,
			description: t.description || '',
			tier,
			tier_source: source,
			default_tier: defaultTierOf(row, t),
			enabled: enabled.has(t.name),
			acknowledged: acknowledged.has(t.name),
			input_schema: t.inputSchema || null,
		};
	});
	const counts = { total: tools.length, enabled: 0, read: 0, write: 0, financial: 0 };
	for (const t of tools) {
		counts[t.tier] += 1;
		if (t.enabled) counts.enabled += 1;
	}
	const catalog = row.catalog_id ? getCatalogEntry(row.catalog_id) : null;
	return {
		id: row.id,
		agent_id: row.agent_id,
		name: row.name,
		tool_prefix: `ext_${row.name}_`,
		catalog_id: row.catalog_id || null,
		label: row.label,
		vendor: catalog?.vendor || null,
		server_url: row.server_url,
		transport: row.transport,
		auth_type: row.auth_type,
		status: row.status,
		has_credentials: Boolean(row.has_credentials),
		needs_review: row.status === 'pending_review',
		tools,
		tool_counts: counts,
		tools_refreshed_at: row.tools_refreshed_at,
		server_info: row.server_info || null,
		last_error: row.last_error || null,
		last_used_at: row.last_used_at,
		reviewed_at: row.reviewed_at,
		token_expires_at: row.token_expires_at,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export async function listForAgent(agentId) {
	return sql`SELECT ${cols()} FROM agent_mcp_connections WHERE agent_id = ${agentId} ORDER BY created_at`;
}

export async function getOwned(agentId, connId, userId) {
	const [row] = await sql`
		SELECT ${cols()} FROM agent_mcp_connections
		WHERE id = ${connId} AND agent_id = ${agentId} AND user_id = ${userId}`;
	return row || null;
}

export async function countForAgent(agentId) {
	const [row] = await sql`SELECT count(*)::int AS n FROM agent_mcp_connections WHERE agent_id = ${agentId}`;
	return row?.n || 0;
}

export async function nameTaken(agentId, name) {
	const [row] = await sql`SELECT 1 AS x FROM agent_mcp_connections WHERE agent_id = ${agentId} AND name = ${name}`;
	return Boolean(row);
}

export async function insertConnection(c) {
	const [row] = await sql`
		INSERT INTO agent_mcp_connections
			(agent_id, user_id, name, catalog_id, server_url, label, transport, auth_type, status)
		VALUES (${c.agentId}, ${c.userId}, ${c.name}, ${c.catalogId}, ${c.serverUrl}, ${c.label}, ${c.transport}, ${c.authType}, ${c.status})
		RETURNING ${cols()}`;
	return row;
}

/** Delete one connection. Its credentials go with the row. */
export async function deleteConnection(agentId, connId, userId) {
	const rows = await sql`
		DELETE FROM agent_mcp_connections
		WHERE id = ${connId} AND agent_id = ${agentId} AND user_id = ${userId}
		RETURNING id`;
	return rows.length > 0;
}

// ── credentials ──────────────────────────────────────────────────────────────

/** @returns {Promise<object>} the decrypted credentials document, `{}` when none. */
export async function readCredentials(connId) {
	const [row] = await sql`SELECT credentials_enc FROM agent_mcp_connections WHERE id = ${connId}`;
	if (!row?.credentials_enc) return {};
	return JSON.parse(await decryptSecret(row.credentials_enc));
}

export async function writeCredentials(connId, creds, { tokenExpiresAt } = {}) {
	const empty = !creds || Object.keys(creds).length === 0;
	const enc = empty ? null : await encryptSecret(JSON.stringify(creds));
	if (tokenExpiresAt === undefined) {
		await sql`UPDATE agent_mcp_connections SET credentials_enc = ${enc}, updated_at = now() WHERE id = ${connId}`;
	} else {
		await sql`
			UPDATE agent_mcp_connections
			SET credentials_enc = ${enc}, token_expires_at = ${tokenExpiresAt}, updated_at = now()
			WHERE id = ${connId}`;
	}
}

// ── OAuth state ──────────────────────────────────────────────────────────────

export async function setOAuthState(connId, state, returnTo, ttlSeconds = 600) {
	await sql`
		UPDATE agent_mcp_connections
		SET oauth_state_hash = ${sha256(state)}, oauth_return_to = ${returnTo},
		    oauth_state_expires_at = now() + make_interval(secs => ${ttlSeconds}), updated_at = now()
		WHERE id = ${connId}`;
}

/** Find the connection waiting on this `state`. Single use: the hash is cleared when it is consumed. */
export async function consumeOAuthState(state) {
	const [row] = await sql`
		UPDATE agent_mcp_connections
		SET oauth_state_hash = NULL, oauth_state_expires_at = NULL, updated_at = now()
		WHERE oauth_state_hash = ${sha256(state)} AND oauth_state_expires_at > now()
		RETURNING id, agent_id, user_id, oauth_return_to`;
	return row || null;
}

// ── tools and status ─────────────────────────────────────────────────────────

export async function saveTools(connId, { tools, serverInfo, enabled, acknowledged, status, reviewedAt }) {
	const [row] = await sql`
		UPDATE agent_mcp_connections
		SET tools = ${JSON.stringify(tools)}::jsonb,
		    tools_refreshed_at = now(),
		    server_info = ${serverInfo ? JSON.stringify(serverInfo) : null}::jsonb,
		    enabled_tools = ${enabled}::text[],
		    acknowledged_tools = ${acknowledged}::text[],
		    status = ${status},
		    reviewed_at = COALESCE(${reviewedAt ?? null}::timestamptz, reviewed_at),
		    last_error = NULL,
		    updated_at = now()
		WHERE id = ${connId}
		RETURNING ${cols()}`;
	return row;
}

export async function saveSelection(connId, { enabled, acknowledged, tierOverrides, status, label, reviewed }) {
	const [row] = await sql`
		UPDATE agent_mcp_connections
		SET enabled_tools = ${enabled}::text[],
		    acknowledged_tools = ${acknowledged}::text[],
		    tier_overrides = ${JSON.stringify(tierOverrides)}::jsonb,
		    status = ${status},
		    label = ${label},
		    reviewed_at = CASE WHEN ${Boolean(reviewed)} THEN now() ELSE reviewed_at END,
		    updated_at = now()
		WHERE id = ${connId}
		RETURNING ${cols()}`;
	return row;
}

export async function setStatus(connId, status, lastError = null) {
	const [row] = await sql`
		UPDATE agent_mcp_connections
		SET status = ${status}, last_error = ${lastError}, updated_at = now()
		WHERE id = ${connId}
		RETURNING ${cols()}`;
	return row;
}

export async function setAuthType(connId, authType) {
	await sql`UPDATE agent_mcp_connections SET auth_type = ${authType}, updated_at = now() WHERE id = ${connId}`;
}

export async function touchUsed(connId) {
	await sql`UPDATE agent_mcp_connections SET last_used_at = now() WHERE id = ${connId}`;
}

/** Active connections the agent loop mounts. Includes the tool list; excludes credentials. */
export async function activeForAgent(agentId) {
	return sql`
		SELECT ${cols()} FROM agent_mcp_connections
		WHERE agent_id = ${agentId} AND status = 'active' AND cardinality(enabled_tools) > 0
		ORDER BY created_at`;
}

export { TIERS };
