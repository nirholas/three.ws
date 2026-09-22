// Shared JSON-RPC 2.0 dispatcher for the focused, payment-free MCP servers
// (3D Studio, x402 Bazaar). The main /api/mcp server keeps its own dispatch
// because it layers pump-agent-payments gating on top; these servers don't, so
// they share this slim core: method routing, scope checks, Ajv arg validation,
// usage accounting, and the MCP error conventions.
import { hasScope } from './auth.js';
import { recordEvent, logger } from './usage.js';
import { sanitizeToolError } from './mcp-error-sanitize.js';
import { handleResourceMethod, RESOURCE_CAPABILITIES } from '../_mcp/resources.js';
import { handlePromptMethod, PROMPT_CAPABILITIES } from '../_mcp/prompts.js';

export const PROTOCOL_VERSION = '2025-06-18';

// Peek the single called tool from a (possibly batched) JSON-RPC body. Used by
// the HTTP endpoints to (a) price the x402 challenge per tool and (b) decide
// whether a request targets a public/free tool. Only a request calling exactly
// ONE tool is reported; mixed batches and non-tools/call messages (initialize,
// tools/list, ping) yield { toolName: null } so they take the default path.
export function peekCalledTool(body) {
	const batch = Array.isArray(body) ? body : [body];
	const calls = batch.filter((m) => m && m.method === 'tools/call');
	if (calls.length === 1) {
		const name = calls[0]?.params?.name;
		return { toolName: typeof name === 'string' ? name : null };
	}
	return { toolName: null };
}

function ok(id, result) {
	return { jsonrpc: '2.0', id, result };
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

function summarize(args) {
	const o = {};
	for (const [k, v] of Object.entries(args || {})) {
		o[k] = typeof v === 'string' && v.length > 64 ? v.slice(0, 64) + '…' : v;
	}
	return o;
}

// Build a dispatch(msg, auth, req) function bound to one server's catalog.
//   serverInfo   { name, version }
//   instructions string shown to clients on initialize
//   catalog      tools/list array (schemas, no handlers)
//   tools        { [name]: { scope?, handler, validate? } }
//   logName      logger namespace + usage `server` tag
//   resourceServer  optional id ('mcp-agent' | 'mcp-3d' | 'mcp-bazaar') that
//                turns on the shared three:// resources and guided prompts
//                (api/_mcp/resources.js, api/_mcp/prompts.js) for this server.
//                Servers without one answer the resources/prompts discovery
//                methods with empty lists.
export function makeDispatcher({ serverInfo, instructions, catalog, tools, logName, resourceServer = null }) {
	const log = logger(logName);

	async function onToolCall(params, auth, started, req) {
		const { name, arguments: args = {} } = params || {};
		// Own-property lookup only — "__proto__"/"constructor" must not resolve an
		// inherited Object member and bypass the !tool guard.
		const tool = typeof name === 'string' && Object.hasOwn(tools, name) ? tools[name] : null;
		if (!tool) throw rpcError(-32602, `unknown tool: ${name}`);
		if (tool.scope && !hasScope(auth.scope, tool.scope)) {
			throw rpcError(-32002, `insufficient scope, requires ${tool.scope}`);
		}
		if (tool.validate && !tool.validate(args)) {
			const first = tool.validate.errors?.[0];
			const detail = first
				? `${first.instancePath || '(root)'} ${first.message || 'invalid'}`
				: 'invalid arguments';
			throw rpcError(-32602, `invalid params for ${name}: ${detail}`);
		}

		const event = {
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
		};
		try {
			const result = await tool.handler(args, auth, req);
			recordEvent({
				...event,
				latencyMs: Date.now() - started,
				meta: { args_summary: summarize(args), server: logName },
			});
			return result;
		} catch (err) {
			recordEvent({
				...event,
				status: 'error',
				latencyMs: Date.now() - started,
				meta: { error: err.message, server: logName },
			});
			if (err.code && typeof err.code === 'number') throw err;
			// Shared sanitizer: suppress pg/driver internals + internal
			// hostnames, log full detail to stderr with a log id, and pass
			// safe handler-authored messages through unchanged.
			const { message } = sanitizeToolError(err, { tool: name, server: logName, log });
			return {
				content: [{ type: 'text', text: `Error: ${message}` }],
				isError: true,
			};
		}
	}

	return async function dispatch(msg, auth, req) {
		const started = Date.now();
		const id = msg.id;
		const isNotification = id === undefined;

		try {
			// Tolerate an absent `jsonrpc` version — minimal/legacy MCP clients
			// omit it on discovery calls; auth and pricing still gate every call.
			// Only reject a version that is present and not "2.0".
			if (msg.jsonrpc != null && msg.jsonrpc !== '2.0') {
				throw rpcError(-32600, 'invalid Request');
			}
			const method = msg.method;

			if (method === 'initialize') {
				return ok(id, {
					protocolVersion: PROTOCOL_VERSION,
					serverInfo,
					capabilities: {
						tools: { listChanged: false },
						resources: resourceServer ? RESOURCE_CAPABILITIES : { listChanged: false, subscribe: false },
						...(resourceServer ? { prompts: PROMPT_CAPABILITIES } : {}),
						logging: {},
					},
					instructions,
				});
			}
			if (method === 'ping') return ok(id, {});
			if (method === 'notifications/initialized') return null;
			if (method === 'tools/list') return ok(id, { tools: catalog });
			if (method === 'tools/call')
				return ok(id, await onToolCall(msg.params, auth, started, req));
			if (resourceServer && typeof method === 'string') {
				if (method.startsWith('resources/')) {
					const result = await handleResourceMethod(resourceServer, method, msg.params, auth, req);
					if (result !== undefined) return ok(id, result);
				}
				if (method.startsWith('prompts/')) {
					const result = handlePromptMethod(resourceServer, catalog, method, msg.params);
					if (result !== undefined) return ok(id, result);
				}
			}
			if (method === 'resources/list') return ok(id, { resources: [] });
			if (method === 'resources/templates/list') return ok(id, { resourceTemplates: [] });
			if (method === 'prompts/list') return ok(id, { prompts: [] });
			if (method === 'logging/setLevel') return ok(id, {});

			throw rpcError(-32601, `method not found: ${method}`);
		} catch (err) {
			log.warn('rpc_error', { method: msg.method, code: err.code, message: err.message });
			if (isNotification) return null;
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: err.code || -32603,
					message: err.message || 'internal error',
					data: err.data,
				},
			};
		}
	};
}
