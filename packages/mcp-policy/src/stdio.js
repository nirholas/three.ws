// The tool policy for stdio MCP packages (npx -y @three-ws/<name>).
//
// One call wires a package:
//
//   const server = new McpServer(...);
//   applyPolicy(server, { serverId: 'x402-mcp', z });
//   for (const tool of TOOLS) server.registerTool(...);   // unchanged
//
// applyPolicy wraps registerTool so a tool the session has not enabled is never
// registered (tools/list omits it, and calling it anyway explains how to turn it
// on), a financial tool gains its confirm flag and preview-id arguments and is
// gated on them, and a preview tool stamps a preview id onto its result.
//
// Enablement for a stdio process, first match wins:
//   THREE_WS_ALLOWED_TOOLS  an exact comma list of tool names
//   THREE_WS_TOOLS          a spec: `trading`, `default,swap_execute`, `all` ...
//   the three-ws CLI store  tools["three-ws-<name>"] in ~/.config/three-ws/credentials.json
//   the default             read and write on, financial off

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { allowListEnablement, defaultEnablement, enablementFromSelection, enablementFromSpec } from './enablement.js';
import { createMemoryPreviewStore, createPolicy } from './runtime.js';

// A stdio server serves one person on their own machine.
const LOCAL_PRINCIPAL = 'local';

/** The CLI's config key for a package: x402-mcp -> three-ws-x402. */
export function cliSlug(serverId) {
	return `three-ws-${serverId.replace(/-mcp$/, '')}`;
}

function credentialsFile(env) {
	if (env.THREE_WS_CREDENTIALS) return env.THREE_WS_CREDENTIALS;
	const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
	return join(base, 'three-ws', 'credentials.json');
}

/** Read the CLI's saved selection for this server; null when there is none. */
function storedSelection(serverId, env) {
	try {
		const store = JSON.parse(readFileSync(credentialsFile(env), 'utf8'));
		return store?.tools?.[cliSlug(serverId)] ?? null;
	} catch {
		return null;
	}
}

/**
 * Resolve which tools this stdio process exposes.
 * @param {string} serverId
 * @param {Record<string, string|undefined>} [env]
 */
export function resolveStdioEnablement(serverId, env = process.env) {
	if (env.THREE_WS_ALLOWED_TOOLS?.trim()) return allowListEnablement(env.THREE_WS_ALLOWED_TOOLS, 'env');
	if (env.THREE_WS_TOOLS?.trim()) return enablementFromSpec(env.THREE_WS_TOOLS, 'env');
	const selection = storedSelection(serverId, env);
	if (selection) return enablementFromSelection(selection, 'cli');
	return defaultEnablement();
}

/** The argument names a zod raw shape or zod object declares. */
function shapeKeys(schema) {
	if (!schema || typeof schema !== 'object') return [];
	if (schema.shape && typeof schema.shape === 'object') return Object.keys(schema.shape);
	return Object.keys(schema);
}

/** Add the policy arguments to a zod raw shape or zod object. */
function extendSchema(schema, additions) {
	if (!Object.keys(additions).length) return schema;
	if (schema && typeof schema.extend === 'function') return schema.extend(additions);
	return { ...(schema || {}), ...additions };
}

/**
 * Put the policy in front of every tool an McpServer registers from now on.
 * Call it before the registerTool loop.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ serverId: string, z: typeof import('zod').z, env?: object, enablement?: object, store?: object }} opts
 *   z: the package's own zod, so the added arguments match its schema version.
 * @returns {{ policy: ReturnType<typeof createPolicy>, enablement: object, hidden: Set<string> }}
 */
export function applyPolicy(server, { serverId, z, env = process.env, enablement, store = createMemoryPreviewStore() }) {
	const en = enablement ?? resolveStdioEnablement(serverId, env);
	const policy = createPolicy({ serverId, store });
	const hidden = new Set();
	const register = server.registerTool.bind(server);
	let interceptorInstalled = false;

	// Calling a tool that was never registered should say how to enable it,
	// not "tool not found". The SDK installs its tools/call handler on the first
	// registration; wrap it once.
	function installInterceptor() {
		if (interceptorInstalled) return;
		const handlers = server.server?._requestHandlers;
		if (!(handlers instanceof Map) || !handlers.has('tools/call')) return;
		const inner = handlers.get('tools/call');
		handlers.set('tools/call', async (request, extra) => {
			const name = request?.params?.name;
			if (typeof name === 'string' && hidden.has(name)) return policy.disabledResult(name, en);
			return inner(request, extra);
		});
		interceptorInstalled = true;
	}

	server.registerTool = (name, config, handler) => {
		if (!policy.enabled(name, en)) {
			hidden.add(name);
			return null;
		}
		const entry = policy.entry(name);
		const ownArgs = shapeKeys(config?.inputSchema);
		let cfg = { ...config, _meta: { ...(config?._meta || {}), 'three.ws/policy': policy.policyMeta(entry) } };

		if (entry?.tier === 'financial' && entry.confirmFlag) {
			const additions = {};
			if (!ownArgs.includes(entry.confirmFlag)) {
				additions[entry.confirmFlag] = z
					.boolean()
					.optional()
					.describe(`Must be true, and only after the user approved the ${entry.previewTool} result.`);
			}
			if (entry.previewArg && !ownArgs.includes(entry.previewArg)) {
				additions[entry.previewArg] = z
					.string()
					.optional()
					.describe(`The ${entry.previewArg} returned by ${entry.previewTool} within the last 10 minutes.`);
			}
			cfg = {
				...cfg,
				description: `${config?.description || ''}${policy.financialNote(entry)}`,
				inputSchema: extendSchema(config?.inputSchema, additions),
			};
		}

		const wrapped = async (args, extra) => {
			const gate = await policy.beforeCall({ name, args: args || {}, en, principal: LOCAL_PRINCIPAL, ownArgs });
			if (!gate.ok) return gate.result;
			const result = await handler(gate.args, extra);
			return policy.afterCall({ name, args: args || {}, principal: LOCAL_PRINCIPAL, result, preview: gate.preview });
		};

		const registered = register(name, cfg, wrapped);
		installInterceptor();
		return registered;
	};

	return { policy, enablement: en, hidden };
}

/**
 * The same policy for a package built on the low-level Server with JSON-Schema
 * tools (ListTools / CallTool request handlers).
 *
 *   const gate = createStdioPolicy('pumpfun-mcp');
 *   ListTools  -> { tools: gate.listTools(TOOLS) }
 *   CallTool   -> gate.callTool(name, args, (cleanArgs) => runTool(name, cleanArgs))
 *
 * @param {string} serverId
 * @param {{ env?: object, enablement?: object, store?: object }} [opts]
 */
export function createStdioPolicy(serverId, { env = process.env, enablement, store = createMemoryPreviewStore() } = {}) {
	const en = enablement ?? resolveStdioEnablement(serverId, env);
	const policy = createPolicy({ serverId, store });
	return {
		policy,
		enablement: en,
		listTools: (tools) => policy.listTools(tools, en),
		async callTool(name, args, run, ownArgs) {
			const declared = ownArgs ?? [];
			const gate = await policy.beforeCall({ name, args: args || {}, en, principal: LOCAL_PRINCIPAL, ownArgs: declared });
			if (!gate.ok) return gate.result;
			const result = await run(gate.args);
			return policy.afterCall({ name, args: args || {}, principal: LOCAL_PRINCIPAL, result, preview: gate.preview });
		},
	};
}
