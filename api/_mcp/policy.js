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

import { createPolicy, resolveEnablement, describeEnablement } from '@three-ws/mcp-policy';

import { cacheDel, cacheGetFresh, cacheSet } from '../_lib/cache.js';
import { sql } from '../_lib/db.js';
import { logger } from '../_lib/usage.js';

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

/**
 * Gate one tools/call. Returns { ok: false, result } with a designed refusal,
 * or { ok: true, args, preview } with the arguments to pass the handler.
 * @param {string[]} ownArgs  argument names the tool's own schema declares
 */
export async function gateCall(serverId, name, args, auth, req, ownArgs = []) {
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
