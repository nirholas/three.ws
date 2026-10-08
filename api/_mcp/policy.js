// The MCP tool policy, bound to the hosted servers.
//
// The policy itself (groups, tiers, confirm flags, preview tools, and the
// enablement grammar) lives in @three-ws/mcp-policy so the hosted servers and
// every stdio package enforce the same table. This module adds what only the
// hosted side has:
//
//   - a preview store in Redis (api/_lib/cache.js), so a quote issued by one
//     Cloud Run instance is honored by whichever instance runs the execution;
//   - saved settings in mcp_tool_settings (account-wide, plus per-API-key
//     overrides), written by /settings/mcp-tools through /api/mcp-tools;
//   - per-request enablement: X-Three-Allowed-Tools, then X-Three-Tools, then
//     the `tools` query parameter, then the key setting, the account setting,
//     and finally the default (read and write on, financial off).
//
// Every dispatcher calls the same three functions: listForRequest on
// tools/list, gateCall before a handler runs, finishCall after it returns.

import { createPolicy, resolveEnablement, describeEnablement, POLICY } from '@three-ws/mcp-policy';

import { cacheDel, cacheGetFresh, cacheSet } from '../_lib/cache.js';
import { sql } from '../_lib/db.js';
import { logger } from '../_lib/usage.js';
import { SCOPES_DOCS_URL, SPEND_BROWSER_URL, SPEND_SCOPE, isConnectorScope, spendRefusalMessage } from '../_lib/spend-scope.js';

const log = logger('mcp-policy');
const PREVIEW_KEY = (id) => `mcp:preview:${id}`;

/** Redis-backed preview store shared by every instance. */
export const hostedPreviewStore = {
	async put(id, record, ttlMs) {
		await cacheSet(PREVIEW_KEY(id), record, Math.ceil(ttlMs / 1000));
	},
	async get(id) {
		if (typeof id !== 'string' || !/^[pq]_[\w-]{16,64}$/.test(id)) return null;
		return (await cacheGetFresh(PREVIEW_KEY(id))) ?? null;
	},
	async del(id) {
		await cacheDel(PREVIEW_KEY(id));
	},
};

const policies = new Map();

/** The policy runtime for one hosted server id (see SERVERS in the package). */
export function policyFor(serverId) {
	if (!policies.has(serverId)) policies.set(serverId, createPolicy({ serverId, store: hostedPreviewStore }));
	return policies.get(serverId);
}

/**
 * Who a preview belongs to. A quote issued to one account can never authorize
 * another account's execution.
 */
export function principalOf(auth) {
	if (auth?.userId) return `user:${auth.userId}`;
	if (auth?.payer) return `x402:${auth.payer}`;
	if (auth?.rateKey) return `rate:${auth.rateKey}`;
	return 'anonymous';
}

// ── Saved settings ────────────────────────────────────────────────────────────

// Settings are read on every tools/list and tools/call, so each instance keeps
// them briefly. A write on this instance clears its copy immediately; other
// instances pick the change up within SETTINGS_TTL_MS.
const SETTINGS_TTL_MS = 15_000;
const settingsMemo = new Map();

function memoKey(userId, apiKeyId) {
	return `${userId}:${apiKeyId || ''}`;
}

/** Forget cached settings for a user (after a write). */
export function invalidateToolSettings(userId) {
	for (const key of settingsMemo.keys()) if (key.startsWith(`${userId}:`)) settingsMemo.delete(key);
}

/**
 * The saved account settings and, when the call is authenticated by an API
 * key, that key's overrides.
 * @returns {Promise<{ account: object|null, key: object|null }>}
 */
export async function loadToolSettings(userId, apiKeyId = null) {
	if (!userId) return { account: null, key: null };
	const k = memoKey(userId, apiKeyId);
	const hit = settingsMemo.get(k);
	if (hit && hit.expires > Date.now()) return hit.value;
	const rows = await sql`
		SELECT api_key_id, settings FROM mcp_tool_settings
		WHERE user_id = ${userId} AND (api_key_id IS NULL OR api_key_id = ${apiKeyId})
	`;
	const value = {
		account: rows.find((r) => !r.api_key_id)?.settings ?? null,
		key: apiKeyId ? (rows.find((r) => r.api_key_id === apiKeyId)?.settings ?? null) : null,
	};
	settingsMemo.set(k, { value, expires: Date.now() + SETTINGS_TTL_MS });
	return value;
}

function headerValue(req, name) {
	const v = req?.headers?.[name];
	return Array.isArray(v) ? v.join(',') : v;
}

function queryValue(req, name) {
	try {
		return new URL(req?.url || '/', 'http://local').searchParams.get(name);
	} catch {
		return null;
	}
}

/**
 * Resolve the enablement for one request. The result is cached on the request
 * so a batch of calls resolves settings once.
 */
export async function enablementFor(req, auth) {
	if (req && req.__threeToolPolicy) return req.__threeToolPolicy;
	const allowedTools = headerValue(req, 'x-three-allowed-tools');
	const headerSpec = headerValue(req, 'x-three-tools');
	const querySpec = queryValue(req, 'tools');
	let saved = { account: null, key: null };
	if (!allowedTools && !headerSpec && !querySpec && auth?.userId) {
		try {
			saved = await loadToolSettings(auth.userId, auth.apiKeyId || null);
		} catch (err) {
			// Fail safe: without the saved settings the session gets the default,
			// which never includes a financial tool.
			log.warn('settings_unavailable', { message: err?.message });
		}
	}
	const en = resolveEnablement({ allowedTools, headerSpec, querySpec, keySettings: saved.key, accountSettings: saved.account });
	if (req && typeof req === 'object') Object.defineProperty(req, '__threeToolPolicy', { value: en, enumerable: false });
	return en;
}

/** tools/list for this request: disabled tools removed, financial ones annotated. */
export async function listForRequest(serverId, catalog, auth, req) {
	return policyFor(serverId).listTools(catalog, await enablementFor(req, auth));
}

// ── The spend gate ──────────────────────────────────────────────────────────
//
// Design rule for cloud connectors: a key or token an agent holds unattended
// can read, generate and edit agent data, and never move funds. Every hosted
// server passes through gateCall, so the rule is enforced once, here, keyed by
// the policy table rather than by each handler remembering its own check.
//
// A tool is value-moving when the table puts it in the financial tier behind a
// confirm flag that names a money consequence (deletes and `confirm_run` acts
// on a house move no money and are left to their own scopes), or when it is a
// write-tier tool that commits or routes funds (SPEND_WRITE_TOOLS).
// tests/mcp-spend-gate.test.js walks every hosted catalog and fails when a tool
// that declares a spend scope is not classified here.

const VALUE_FLAGS = new Set([
	'confirm_swap',
	'confirm_transfer',
	'confirm_launch',
	'confirm_spend',
	'confirm_payment',
	'confirm_deposit',
	'confirm_withdraw',
	'confirm_bid',
	'confirm_send',
	'confirm_listing',
	'confirm_delist',
	'confirm_accept',
	'confirm_trade',
	'confirm_reveal',
	'confirm_cancel',
]);

// Write-tier tools that need a spend grant: card quotes and secrets, wallet
// provisioning (the custodial address funds are routed to, and a devnet
// airdrop), and publishing a paid endpoint, which decides where its earnings
// go. Value: the scope the tool requires. A write tool that moves nothing
// (predictions_watch) keeps its own handler check and stays out of this list.
export const SPEND_WRITE_TOOLS = Object.freeze({
	'three.ws': Object.freeze({
		agent_card_quote: SPEND_SCOPE,
		agent_card_data: SPEND_SCOPE,
		agent_card_connect_link: SPEND_SCOPE,
	}),
	'threews-agent': Object.freeze({
		provision_wallet: SPEND_SCOPE,
		monetize_endpoint: 'services:write',
	}),
});

/**
 * The scope a hosted tool needs because it moves value, or null when it moves
 * none. Financial value-moving tools need `wallet:write`.
 */
export function spendScopeFor(serverId, name) {
	const extra = SPEND_WRITE_TOOLS[serverId];
	if (extra && Object.hasOwn(extra, name)) return extra[name];
	const entry = POLICY[serverId]?.[name];
	if (entry?.tier === 'financial' && VALUE_FLAGS.has(entry.confirmFlag)) return SPEND_SCOPE;
	return null;
}

function holds(scope, required) {
	return String(scope || '').split(/\s+/).includes(required);
}

/** JSON-RPC error code for "this credential may not move funds". */
export const SPEND_REFUSED_CODE = -32003;

/**
 * Refuse a value-moving call from an account-bound bearer that lacks the
 * spend scope, before enablement or previews are consulted: turning the tool
 * on in settings cannot help a key that may never spend, so the caller is told
 * the one thing that does. Anonymous principals (free, x402) hold no account
 * funds and fall through to the handlers' own ownership checks.
 * Throws a JSON-RPC error every dispatcher renders as-is.
 */
export function assertMaySpend(serverId, name, auth) {
	const required = spendScopeFor(serverId, name);
	if (!required || !auth?.userId || holds(auth.scope, required)) return;
	const connector = isConnectorScope(auth.scope);
	const err = new Error(spendRefusalMessage(auth.scope, { action: name, required }));
	err.code = SPEND_REFUSED_CODE;
	err.data = {
		reason: connector ? 'connector_key_cannot_spend' : 'spend_scope_required',
		tool: name,
		required_scope: required,
		needs: 'browser_session',
		url: SPEND_BROWSER_URL,
		docs: SCOPES_DOCS_URL,
	};
	throw err;
}

/**
 * Gate one tools/call. Returns { ok: false, result } with a designed refusal,
 * or { ok: true, args, preview } with the arguments to pass the handler.
 * Throws the spend refusal (assertMaySpend) as a JSON-RPC error.
 * @param {string[]} ownArgs  argument names the tool's own schema declares
 */
export async function gateCall(serverId, name, args, auth, req, ownArgs = []) {
	assertMaySpend(serverId, name, auth);
	const en = await enablementFor(req, auth);
	return policyFor(serverId).beforeCall({ name, args, en, principal: principalOf(auth), ownArgs });
}

/** Stamp a preview id onto a preview result, or burn the one a financial call spent. */
export async function finishCall(serverId, name, args, auth, result, preview) {
	return policyFor(serverId).afterCall({ name, args, principal: principalOf(auth), result, preview });
}

/** Argument names declared by a JSON Schema tool. */
export function declaredArgs(tool) {
	return Object.keys(tool?.inputSchema?.properties || {});
}

/**
 * Read a preview record for a handler that needs the previewed arguments (the
 * swap and payment executors). Returns null for an unknown, expired, foreign
 * or mismatched id; the gate has already refused those, so a null here only
 * means the record vanished between gate and handler.
 */
export async function readPreview(id, auth, { tool } = {}) {
	const record = await hostedPreviewStore.get(id);
	if (!record || record.principal !== principalOf(auth)) return null;
	if (tool && record.tool !== tool) return null;
	return record;
}

export { describeEnablement };
