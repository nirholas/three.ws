// The connection lifecycle: connect, review, authorize, select tools, refresh,
// remove. Routes, the CLI and the MCP tools are thin callers of this module,
// so the safety rules (custom servers start with nothing enabled, a write or
// financial tool needs an acknowledgement, a changed tool is re-reviewed) hold
// whichever door the request came through.
//
// Errors are ConnectionError. It carries `status` and `code`, which is the
// shape api/_lib/agents-v1/http.js already turns into a 4xx envelope.

import { createHash } from 'node:crypto';
import { getCatalogEntry, platformClientConfigured } from './catalog.js';
import { classifyTools, defaultEnabledTools, TIERS } from './classify.js';
import { fetchTools, probeServer, McpConnectError } from './client.js';
import { assertServerUrl } from './safe-fetch.js';
import { startOAuth, finishOAuth, authProviderFor, ensureFreshToken } from './oauth.js';
import * as store from './store.js';

export class ConnectionError extends Error {
	constructor(status, code, message, detail = null) {
		super(message);
		this.name = 'ConnectionError';
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

const DEFAULT_RETURN = '/mcp-integrations';
const MAX_LABEL = 80;
const MAX_TOKEN = 4096;

function fromMcp(err) {
	if (err instanceof ConnectionError) return err;
	if (err instanceof McpConnectError) {
		const status = { blocked_url: 400, needs_auth: 409, unreachable: 502, protocol: 502, tool_error: 502 }[err.code] || 502;
		return new ConnectionError(status, err.code, err.message);
	}
	return err;
}

/** A same-origin path to come back to, or the default. */
export function safeReturnTo(value) {
	const v = String(value || '');
	return v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') && v.length <= 300 ? v : DEFAULT_RETURN;
}

export function slugName(base) {
	const s = String(base || 'server')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 24)
		.replace(/_+$/g, '');
	return s || 'server';
}

async function uniqueName(agentId, base) {
	const root = slugName(base);
	if (!(await store.nameTaken(agentId, root))) return root;
	for (let i = 2; i < 100; i++) {
		const candidate = `${root.slice(0, 24 - String(i).length - 1)}_${i}`;
		if (!(await store.nameTaken(agentId, candidate))) return candidate;
	}
	throw new ConnectionError(409, 'name_taken', 'Could not choose a unique name for this connection.');
}

const fingerprint = (t) =>
	createHash('sha256').update(JSON.stringify([t.name, t.description || '', t.inputSchema || null])).digest('hex').slice(0, 16);

/** What is stored per tool: enough to present, classify and mount it. */
function toStored(classified) {
	return classified.map((t) => ({
		name: t.name,
		title: t.title,
		description: t.description,
		inputSchema: t.inputSchema,
		annotations: t.annotations,
		fingerprint: fingerprint(t),
	}));
}

/** Request headers for a bearer credential, honoring a catalog entry's custom header. */
function bearerHeaders(row, token) {
	const header = row.catalog_id ? getCatalogEntry(row.catalog_id)?.auth?.header : null;
	return header ? { [header]: token } : { Authorization: `Bearer ${token}` };
}

/**
 * How to authenticate one session for a stored connection: a static header for
 * a pasted token, or an OAuth provider (refreshed first when the token is about
 * to lapse).
 * @returns {Promise<{ headers?: object, authProvider?: object }>}
 */
export async function sessionAuth(row) {
	const creds = await store.readCredentials(row.id);
	if (creds.bearer) return { headers: bearerHeaders(row, creds.bearer) };
	if (row.auth_type !== 'oauth') return {};
	if (!creds.tokens) throw new ConnectionError(409, 'needs_auth', 'This connection has not been signed in yet.');
	if (!(await ensureFreshToken(row))) {
		throw new ConnectionError(409, 'needs_auth', 'The sign-in for this connection expired. Reconnect it.');
	}
	return { authProvider: await authProviderFor(row) };
}

/**
 * List the server's tools and store them. First load: a catalog server starts
 * with its read tools enabled, a custom one with nothing until reviewed.
 * Refresh: tools the owner enabled stay enabled, except a write or financial
 * tool whose description or schema changed, which goes back for review.
 */
export async function loadTools(row) {
	const custom = !row.catalog_id;
	let fetched;
	try {
		fetched = await fetchTools({ url: row.server_url, transport: row.transport, ...(await sessionAuth(row)) });
	} catch (err) {
		const e = fromMcp(err);
		if (e.code === 'needs_auth') await store.setStatus(row.id, 'needs_auth', e.message);
		else if (row.status !== 'pending_auth' && row.status !== 'pending_review') await store.setStatus(row.id, 'error', e.message);
		throw e;
	}
	const classified = classifyTools(fetched.tools, { rules: store.rulesFor(row), overrides: row.tier_overrides });
	const stored = toStored(classified);
	const first = !row.tools_refreshed_at;
	let enabled;
	let acknowledged;
	if (first) {
		enabled = defaultEnabledTools(classified, { custom });
		acknowledged = [];
	} else {
		const before = new Map((row.tools || []).map((t) => [t.name, t.fingerprint]));
		const now = new Map(stored.map((t) => [t.name, t]));
		const tierOf = new Map(classified.map((t) => [t.name, t.tier]));
		const keep = (n) => now.has(n) && (tierOf.get(n) === 'read' || before.get(n) === now.get(n).fingerprint);
		enabled = (row.enabled_tools || []).filter(keep);
		acknowledged = (row.acknowledged_tools || []).filter(keep);
	}
	const reviewed = custom ? Boolean(row.reviewed_at) : true;
	const status = reviewed ? 'active' : 'pending_review';
	return store.saveTools(row.id, { tools: stored, serverInfo: fetched.serverInfo, enabled, acknowledged, status });
}

export async function listConnections(agentId) {
	return (await store.listForAgent(agentId)).map(store.presentConnection);
}

/**
 * Connect an agent to a server from the catalog or by URL.
 * @param {{ agentId: string, userId: string, catalogId?: string, serverUrl?: string, transport?: string,
 *   label?: string, bearerToken?: string }} o
 */
export async function createConnection(o) {
	if ((await store.countForAgent(o.agentId)) >= store.MAX_CONNECTIONS_PER_AGENT) {
		throw new ConnectionError(409, 'too_many_connections', `An agent can have at most ${store.MAX_CONNECTIONS_PER_AGENT} connections. Remove one first.`);
	}
	const token = o.bearerToken == null ? null : String(o.bearerToken).trim();
	if (token !== null && (token.length < 8 || token.length > MAX_TOKEN)) {
		throw new ConnectionError(400, 'bad_token', 'The access token looks wrong. Paste the whole token.');
	}

	let spec;
	if (o.catalogId) {
		const entry = getCatalogEntry(o.catalogId);
		if (!entry) throw new ConnectionError(404, 'unknown_catalog_id', `No catalog server named "${o.catalogId}".`);
		if (entry.transport === 'stdio') {
			throw new ConnectionError(422, 'stdio_not_hosted', `${entry.name} runs on your machine, not on three.ws. Install it locally: ${entry.docs}`);
		}
		const oauthReady = entry.auth.type !== 'oauth' || platformClientConfigured(entry);
		if (!oauthReady && entry.auth.alt !== 'bearer' && !token) {
			throw new ConnectionError(409, 'oauth_unavailable', `Sign-in for ${entry.name} is not configured on this deployment.`);
		}
		const authType = token ? 'bearer' : entry.auth.type;
		spec = { url: entry.url, transport: entry.transport, label: entry.name, name: entry.id.replace(/-mcp$/, ''), authType, catalog: entry, custom: false };
	} else {
		let url;
		try {
			url = assertServerUrl(o.serverUrl);
		} catch (err) {
			throw fromMcp(err);
		}
		const transport = o.transport === 'sse' ? 'sse' : 'streamable-http';
		const label = String(o.label || url.hostname).trim().slice(0, MAX_LABEL) || url.hostname;
		spec = { url: url.href, transport, label, name: url.hostname.split('.').slice(-2, -1)[0] || url.hostname, authType: token ? 'bearer' : null, catalog: null, custom: true };
	}

	// Probe before inserting, so a server that cannot be reached leaves no row.
	let probed = null;
	if (!token && (spec.custom || spec.authType === 'none')) {
		try {
			probed = await probeServer(spec.url, { transport: spec.transport });
		} catch (err) {
			throw fromMcp(err);
		}
		if (spec.custom) spec.authType = probed.auth;
	}

	const row = await store.insertConnection({
		agentId: o.agentId,
		userId: o.userId,
		name: await uniqueName(o.agentId, spec.name),
		catalogId: spec.catalog?.id || null,
		serverUrl: spec.url,
		label: o.label ? String(o.label).trim().slice(0, MAX_LABEL) || spec.label : spec.label,
		transport: spec.transport,
		authType: spec.authType,
		status: 'pending_auth',
	});

	const needsSignIn = spec.authType === 'oauth' || (spec.authType === 'bearer' && !token);
	if (needsSignIn) return store.presentConnection(row);
	try {
		if (token) await store.writeCredentials(row.id, { bearer: token });
		return store.presentConnection(await loadTools(row));
	} catch (err) {
		await store.deleteConnection(o.agentId, row.id, o.userId);
		if (err?.code === 'needs_auth' && token) throw new ConnectionError(422, 'token_rejected', 'The server rejected that access token.');
		throw fromMcp(err);
	}
}

/** Re-list a connection's tools. */
export async function refreshConnection(row) {
	if (row.status === 'pending_auth') throw new ConnectionError(409, 'needs_auth', 'Sign in to this server first.');
	return store.presentConnection(await loadTools(row));
}

/**
 * Start sign-in. Returns `{ authorization_url }` to send the owner to, or the
 * connection itself when its stored tokens were still valid.
 */
export async function startAuth(row, { returnTo } = {}) {
	if (row.auth_type !== 'oauth') {
		throw new ConnectionError(400, 'not_oauth', 'This connection uses an access token. Send `bearer_token` instead.');
	}
	let url;
	try {
		url = await startOAuth(row, { returnTo: safeReturnTo(returnTo) });
	} catch (err) {
		if (err?.code === 'oauth_unavailable') throw new ConnectionError(409, 'oauth_unavailable', err.message);
		throw fromMcp(err instanceof McpConnectError ? err : new McpConnectError(`Could not start sign-in: ${String(err?.message || err).slice(0, 200)}`, 'protocol'));
	}
	if (!url) return { connection: store.presentConnection(await loadTools(row)) };
	return { authorization_url: url };
}

/** Store a pasted access token and list the server's tools with it. */
export async function setBearerToken(row, token) {
	const t = String(token || '').trim();
	if (t.length < 8 || t.length > MAX_TOKEN) throw new ConnectionError(400, 'bad_token', 'The access token looks wrong. Paste the whole token.');
	const entry = row.catalog_id ? getCatalogEntry(row.catalog_id) : null;
	if (row.auth_type === 'oauth' && entry?.auth?.alt !== 'bearer') {
		throw new ConnectionError(400, 'not_bearer', 'This connection signs in with OAuth.');
	}
	const prior = await store.readCredentials(row.id);
	await store.writeCredentials(row.id, { bearer: t }, { tokenExpiresAt: null });
	const asBearer = { ...row, auth_type: 'bearer' };
	try {
		const updated = await loadTools(asBearer);
		await store.setAuthType(row.id, 'bearer');
		return store.presentConnection({ ...updated, auth_type: 'bearer' });
	} catch (err) {
		await store.writeCredentials(row.id, prior, { tokenExpiresAt: null });
		if (err?.code === 'needs_auth') throw new ConnectionError(422, 'token_rejected', 'The server rejected that access token.');
		throw err;
	}
}

/**
 * Finish the OAuth redirect. Never throws: every outcome is a path to send the
 * browser to, with `mcp_connected` or `mcp_error` in the query.
 * @returns {Promise<string>}
 */
export async function completeAuth({ state, code, error, sessionUserId }) {
	const to = (path, params) => {
		const u = new URL(safeReturnTo(path), 'http://x');
		for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
		return `${u.pathname}${u.search}`;
	};
	if (!state) return to(DEFAULT_RETURN, { mcp_error: 'invalid_state' });
	const pending = await store.consumeOAuthState(state);
	if (!pending) return to(DEFAULT_RETURN, { mcp_error: 'invalid_state' });
	const back = pending.oauth_return_to;
	if (!sessionUserId || String(sessionUserId) !== String(pending.user_id)) return to(back, { mcp_error: 'wrong_account' });
	const row = await store.getOwned(pending.agent_id, pending.id, pending.user_id);
	if (!row) return to(back, { mcp_error: 'invalid_state' });
	if (error) {
		await store.setStatus(row.id, row.tools_refreshed_at ? 'needs_auth' : 'pending_auth', `Sign-in was not completed (${String(error).slice(0, 80)}).`);
		return to(back, { mcp_error: 'denied', mcp_connection: row.id });
	}
	if (!code) return to(back, { mcp_error: 'invalid_state', mcp_connection: row.id });
	try {
		await finishOAuth(row, { code: String(code) });
		await loadTools(row);
	} catch (err) {
		await store.setStatus(row.id, row.tools_refreshed_at ? 'needs_auth' : 'pending_auth', `Sign-in failed: ${String(err?.message || err).slice(0, 200)}`);
		return to(back, { mcp_error: 'exchange_failed', mcp_connection: row.id });
	}
	return to(back, { mcp_connected: row.id });
}

/** The tools that must be acknowledged before they can be enabled. */
function needsAcknowledgement(row, tool) {
	return store.tierOf(row, tool).tier !== 'read' || store.defaultTierOf(row, tool) !== 'read';
}

/**
 * Change which tools are on. `enabled_tools` replaces the set; a write or
 * financial tool can only be in it when it is also acknowledged.
 * @param {object} row
 * @param {{ enabled_tools?: string[], tier_overrides?: Record<string,string|null>, acknowledge?: string[],
 *   label?: string, reviewed?: boolean, disabled?: boolean }} patch
 */
export async function updateSelection(row, patch) {
	const known = new Map((row.tools || []).map((t) => [t.name, t]));
	const must = (name) => {
		if (!known.has(name)) throw new ConnectionError(400, 'unknown_tool', `This server has no tool named "${name}".`);
	};

	const overrides = { ...(row.tier_overrides || {}) };
	if (patch.tier_overrides) {
		for (const [name, tier] of Object.entries(patch.tier_overrides)) {
			must(name);
			if (tier === null) delete overrides[name];
			else if (TIERS.includes(tier)) overrides[name] = tier;
			else throw new ConnectionError(400, 'bad_tier', `Tier must be one of ${TIERS.join(', ')}.`);
		}
	}
	const next = { ...row, tier_overrides: overrides };

	let enabled = row.enabled_tools || [];
	if (patch.enabled_tools) {
		if (!Array.isArray(patch.enabled_tools)) throw new ConnectionError(400, 'bad_request', '`enabled_tools` must be a list of tool names.');
		patch.enabled_tools.forEach(must);
		enabled = [...new Set(patch.enabled_tools)];
	}
	const ackIn = patch.acknowledge || [];
	if (!Array.isArray(ackIn)) throw new ConnectionError(400, 'bad_request', '`acknowledge` must be a list of tool names.');
	ackIn.forEach(must);
	const acknowledged = [...new Set([...(row.acknowledged_tools || []), ...ackIn])].filter((n) => known.has(n));

	const missing = enabled.filter((n) => needsAcknowledgement(next, known.get(n)) && !acknowledged.includes(n));
	if (missing.length) {
		throw new ConnectionError(
			409,
			'acknowledgement_required',
			'These tools change something in the other system or cannot be undone. Acknowledge them to turn them on.',
			{ tools: missing },
		);
	}

	let status = row.status;
	if (patch.disabled === true) status = 'disabled';
	else if (patch.disabled === false && row.status === 'disabled') status = row.tools_refreshed_at ? 'active' : 'pending_auth';
	if (status === 'pending_review' && patch.reviewed === true) status = 'active';

	const label = patch.label == null ? row.label : String(patch.label).trim().slice(0, MAX_LABEL) || row.label;
	const saved = await store.saveSelection(row.id, {
		enabled,
		acknowledged,
		tierOverrides: overrides,
		status,
		label,
		reviewed: patch.reviewed === true && row.status === 'pending_review',
	});
	return store.presentConnection(saved);
}

export async function removeConnection(agentId, connId, userId) {
	if (!(await store.deleteConnection(agentId, connId, userId))) {
		throw new ConnectionError(404, 'connection_not_found', 'No such connection on this agent.');
	}
	return { id: connId, deleted: true };
}
