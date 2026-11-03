// The unified MCP server's JSON-RPC dispatcher (https://three.ws/mcp).
//
// One registry (api/_mcpall/registry.js) holds every tool of every hosted
// three.ws MCP server. This module answers the MCP methods over it:
//
//   initialize, ping, logging/setLevel
//   tools/list   the policy-enabled tools for this request (anonymous callers
//                see only the public set)
//   tools/call   resolve name or legacy alias -> connector guard -> policy gate
//                -> sign-in check -> source quota gate -> the source's own
//                runner, which does the scope check, validation, x402 and credit handling
//   resources/*  the union of the hosted servers' three:// resources
//   prompts/*    the guided prompts, with tool names rewritten to unified names
//
// The transport (auth, x402 challenge and settle, rate limits) is in
// api/mcp/all.js, the same split as api/mcp.js and api/_mcp/dispatch.js.

import { createPolicy } from '@three-ws/mcp-policy';

import { recordEvent, logger } from '../_lib/usage.js';
import { sanitizeToolError } from '../_lib/mcp-error-sanitize.js';
import { declareMcpDiscovery } from '../_lib/x402/bazaar-helpers.js';
import { enablementFor, principalOf, hostedPreviewStore, movesValue, connectorSpendError, declaredArgs } from '../_mcp/policy.js';
import { handleResourceMethod, RESOURCE_CAPABILITIES } from '../_mcp/resources.js';
import { handlePromptMethod, PROMPT_CAPABILITIES } from '../_mcp/prompts.js';
import { PROTOCOL_VERSION, ok, rpcError } from '../_mcp/dispatch.js';
import { buildRegistry, bootProblems, makeRenamer, renameResult, UNIFIED_SERVER, UNIFIED_RESOURCE_SERVER, UNIFIED_ENDPOINT } from './registry.js';
import { makeOwnTools } from './own-tools.js';

export { PROTOCOL_VERSION };

const log = logger('mcp-all');
const SERVER_INFO = { name: 'three.ws', title: 'three.ws (every tool)', version: '1.0.0' };

let state = null;

/** The registry, policy runtime and renamer, built once per process. */
export function unified() {
	if (state) return state;
	const registry = buildRegistry({ ownTools: makeOwnTools(() => registry) });
	const fatal = bootProblems(registry.problems);
	if (fatal.length) {
		throw new Error(`unified MCP registry failed to build:\n${fatal.map((p) => `  ${p.kind}: ${p.message}`).join('\n')}`);
	}
	const policy = createPolicy({
		serverId: UNIFIED_SERVER,
		table: { [UNIFIED_SERVER]: registry.policyTable },
		store: hostedPreviewStore,
	});
	const legacyMap = new Map();
	for (const [legacy, list] of registry.aliases) if (list.length === 1) legacyMap.set(legacy, list[0]);
	const rename = makeRenamer(legacyMap);
	// Prompts are written against the legacy tool names; hand them a catalog
	// under those names and rename the rendered text afterwards.
	const promptCatalog = [];
	const seen = new Set();
	for (const t of registry.tools) {
		const name = t.legacyName || t.name;
		if (seen.has(name)) continue;
		seen.add(name);
		promptCatalog.push({ ...t.def, name });
	}
	state = { registry, policy, rename, promptCatalog };
	return state;
}

/** Test hook: drop the cached registry. */
export function resetUnified() {
	state = null;
}

/** Resolve a called name: a unified name, or a legacy name that is unambiguous. */
export function resolveTool(registry, name) {
	if (typeof name !== 'string') return null;
	if (registry.byName.has(name)) return registry.byName.get(name);
	const list = registry.aliases.get(name);
	if (list?.length === 1) return registry.byName.get(list[0]);
	return null;
}

function toolEntry(t) {
	const price = t.price?.({}) || null;
	const entry = { ...t.def };
	if (!price) return entry;
	return {
		...entry,
		pricing: { amount_usdc: Number(price) / 1e6, currency: 'USDC', scheme: 'x402' },
		extensions: {
			bazaar: declareMcpDiscovery({
				toolName: t.name,
				description: t.def.description,
				transport: 'streamable-http',
				inputSchema: t.def.inputSchema,
			}),
		},
	};
}

/** tools/list for one request. */
export async function listTools(auth, req) {
	const { registry, policy } = unified();
	const anonymous = auth?.source === 'free';
	const visible = registry.tools.filter((t) => (anonymous ? t.isPublic : true));
	const listed = await policy.listTools(
		visible.map((t) => t.def),
		await enablementFor(req, auth),
	);
	const kept = auth?.connector ? listed.filter((d) => !movesValue(UNIFIED_SERVER, d.name) && !movesToolRow(registry, d.name)) : listed;
	return kept.map((d) => {
		const t = registry.byName.get(d.name);
		const entry = t ? toolEntry(t) : d;
		return { ...d, ...(entry.pricing ? { pricing: entry.pricing, extensions: entry.extensions } : {}) };
	});
}

function movesToolRow(registry, name) {
	const t = registry.byName.get(name);
	return Boolean(t && t.tier === 'financial' && !/^(confirm_delete|confirm_run)$/.test(registry.policyTable[name]?.confirmFlag || ''));
}

function summarizeArgs(args) {
	const o = {};
	for (const [k, v] of Object.entries(args || {})) o[k] = typeof v === 'string' && v.length > 64 ? `${v.slice(0, 64)}...` : v;
	return o;
}

function errorResult(text, structured) {
	return { content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}), isError: true };
}

/** tools/call for one request. */
export async function callTool(params, auth, req) {
	const started = Date.now();
	const { registry, policy, rename } = unified();
	const { name: called, arguments: rawArgs = {} } = params || {};
	const t = resolveTool(registry, called);
	if (!t) {
		const hint = typeof called === 'string' ? registry.aliases.get(called) : null;
		throw rpcError(-32602, hint?.length > 1 ? `ambiguous tool name: ${called} (use one of ${hint.join(', ')})` : `unknown tool: ${called}`);
	}
	const name = t.name;
	if (auth?.connector && (movesToolRow(registry, name) || movesValue(UNIFIED_SERVER, name))) throw connectorSpendError(name);

	const sentArgs = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};
	const gate = await policy.beforeCall({
		name,
		args: sentArgs,
		en: await enablementFor(req, auth),
		principal: principalOf(auth),
		ownArgs: declaredArgs(t.def),
	});
	if (!gate.ok) return renameResult(gate.result, rename);
	const args = gate.args === sentArgs ? { ...rawArgs } : gate.args;

	if (auth?.source === 'free' && !t.isPublic) {
		return errorResult(
			`${name} needs a three.ws account. Sign in through your MCP client (OAuth) or send an API key as a Bearer token. Create one at https://three.ws/settings/api-keys.`,
			{ ok: false, reason: 'auth_required', tool: name },
		);
	}
	if (t.requiresPrincipal && !auth?.userId && auth?.source !== 'x402') {
		return errorResult(`${name} needs a signed-in account.`, { ok: false, reason: 'auth_required', tool: name });
	}
	if (t.before) {
		const refused = await t.before({ req, auth });
		if (refused) return refused;
	}

	try {
		const result = await t.run(args, auth, req);
		recordEvent({
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
			latencyMs: Date.now() - started,
			meta: { args_summary: summarizeArgs(args), via: UNIFIED_RESOURCE_SERVER },
		});
		const finished = await policy.afterCall({ name, args: sentArgs, principal: principalOf(auth), result, preview: gate.preview });
		return renameResult(finished, t.rename || rename);
	} catch (err) {
		recordEvent({
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
			status: 'error',
			latencyMs: Date.now() - started,
			meta: { error: err.message, via: UNIFIED_RESOURCE_SERVER },
		});
		if (err.code && typeof err.code === 'number') throw err;
		const { message } = sanitizeToolError(err, { tool: name, server: UNIFIED_RESOURCE_SERVER, log });
		return errorResult(`Error: ${message}`);
	}
}

async function initialize(auth) {
	const { registry } = unified();
	return {
		protocolVersion: PROTOCOL_VERSION,
		serverInfo: SERVER_INFO,
		capabilities: {
			tools: { listChanged: false },
			resources: RESOURCE_CAPABILITIES,
			prompts: PROMPT_CAPABILITIES,
			logging: {},
		},
		instructions: [
			`One endpoint for every three.ws tool (${registry.tools.length} in ${new Set(registry.tools.map((t) => t.group)).size} groups).`,
			'Tools are named <group>_<tool>. Call utility_getting_started first for an overview.',
			'Read and write tools are on by default. Money-moving tools are off until their group is enabled, and each one needs a preview first and an explicit confirm flag.',
			'Live account views are three:// resources; utility_read_resource reads them for clients without a resource reader.',
			auth?.source === 'free' ? `Sign in to unlock the account tools: ${UNIFIED_ENDPOINT} supports OAuth and API keys.` : '',
		]
			.filter(Boolean)
			.join(' '),
	};
}

/** Dispatch one JSON-RPC message. Returns the response object, or null for a notification. */
export async function dispatch(msg, auth, req) {
	const id = msg?.id;
	const isNotification = id === undefined;
	try {
		if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw rpcError(-32600, 'invalid Request');
		if (msg.jsonrpc != null && msg.jsonrpc !== '2.0') throw rpcError(-32600, 'invalid Request');
		const method = msg.method;
		if (method === 'initialize') return ok(id, await initialize(auth));
		if (method === 'ping') return ok(id, {});
		if (typeof method === 'string' && method.startsWith('notifications/')) return null;
		if (method === 'tools/list') return ok(id, { tools: await listTools(auth, req) });
		if (method === 'tools/call') return ok(id, await callTool(msg.params, auth, req));
		if (typeof method === 'string' && method.startsWith('resources/')) {
			const result = await handleResourceMethod(UNIFIED_RESOURCE_SERVER, method, msg.params, auth, req);
			if (result !== undefined) return ok(id, result);
		}
		if (typeof method === 'string' && method.startsWith('prompts/')) {
			const { promptCatalog, rename } = unified();
			const result = handlePromptMethod('mcp', promptCatalog, method, msg.params);
			if (result !== undefined) return ok(id, JSON.parse(JSON.stringify(result), (_k, v) => (typeof v === 'string' ? rename(v) : v)));
		}
		if (method === 'logging/setLevel') return ok(id, {});
		throw rpcError(-32601, `method not found: ${method}`);
	} catch (err) {
		log.warn('rpc_error', { method: msg?.method, code: err.code, message: err.message });
		if (isNotification) return null;
		return { jsonrpc: '2.0', id: id ?? null, error: { code: err.code || -32603, message: err.message || 'internal error', data: err.data } };
	}
}

/** The registry-based price of a batch, for the HTTP layer. */
export function priceOptions() {
	return {
		priceForTool: (name, args) => {
			const t = resolveTool(unified().registry, name);
			return t ? t.price(args || {}) : null;
		},
		isFreeName: (name) => Boolean(resolveTool(unified().registry, name)?.isPublic),
	};
}
