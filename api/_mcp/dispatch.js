import { hasScope } from '../_lib/auth.js';
import { recordEvent, logger } from '../_lib/usage.js';
import { priceFor, findActiveSubscription, resolveBillingMint } from '../_lib/pump-pricing.js';
import { TOOL_CATALOG, TOOLS } from './catalog.js';

export const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: '3d-agent-mcp', version: '1.0.0' };
const log = logger('mcp');

export function ok(id, result) {
	return { jsonrpc: '2.0', id, result };
}

export function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

export async function dispatch(msg, auth, _req) {
	const started = Date.now();
	const id = msg.id;
	const isNotification = id === undefined;

	try {
		if (msg.jsonrpc !== '2.0') throw rpcError(-32600, 'invalid Request');
		const method = msg.method;

		if (method === 'initialize') return ok(id, await onInitialize(msg.params, auth));
		if (method === 'ping') return ok(id, {});
		if (method === 'notifications/initialized') return null;
		if (method === 'tools/list')
			return ok(id, {
				tools: TOOL_CATALOG.map((t) => {
					const price = priceFor(t.name);
					return price
						? {
								...t,
								pricing: {
									amount_usdc: price.amount_usdc,
									currency: 'USDC',
									description: price.description,
									scheme: 'pump-agent-payments',
									prep_endpoint: '/api/pump/accept-payment-prep',
									confirm_endpoint: '/api/pump/accept-payment-confirm',
									recipient_mint: resolveBillingMint(),
								},
							}
						: t;
				}),
			});
		if (method === 'tools/call') return ok(id, await onToolCall(msg.params, auth, started));
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
}

function summarize(args) {
	const o = {};
	for (const [k, v] of Object.entries(args || {})) {
		o[k] = typeof v === 'string' && v.length > 64 ? v.slice(0, 64) + '…' : v;
	}
	return o;
}

async function onInitialize(_params, _auth) {
	return {
		protocolVersion: PROTOCOL_VERSION,
		serverInfo: SERVER_INFO,
		capabilities: {
			tools: { listChanged: false },
			resources: { listChanged: false, subscribe: false },
			logging: {},
		},
		instructions: [
			'Render 3D avatars stored on three.ws as <model-viewer> HTML artifacts.',
			"Use list_my_avatars to see the user's avatars and render_avatar to get embeddable viewer HTML.",
			'Public avatars can be discovered via search_public_avatars.',
		].join(' '),
	};
}

async function onToolCall(params, auth, started) {
	const { name, arguments: args = {} } = params || {};
	const tool = TOOLS[name];
	if (!tool) throw rpcError(-32602, `unknown tool: ${name}`);
	if (tool.scope && !hasScope(auth.scope, tool.scope)) {
		throw rpcError(-32002, `insufficient scope, requires ${tool.scope}`);
	}

	// Pump-agent-payments gate. Free tools and paid-bearer-authenticated users
	// (existing subscription plans) bypass. x402 callers and anonymous payers
	// must either supply X-PAYMENT (handled at the HTTP layer above) or have
	// an active pump-agent-payments subscription window for this tool.
	const price = priceFor(name);
	if (price && auth.source === 'x402') {
		const billingMint = resolveBillingMint();
		const payerWallet = args.payer_wallet || auth.payer || null;
		if (billingMint && payerWallet) {
			const sub = await findActiveSubscription({
				mint: billingMint,
				network: process.env.PUMP_DEFAULT_NETWORK || 'mainnet',
				payerWallet,
				toolName: name,
			});
			if (!sub) {
				throw rpcError(-32402, 'payment required for this tool', {
					scheme: 'pump-agent-payments',
					tool: name,
					amount_usdc: price.amount_usdc,
					recipient_mint: billingMint,
					prep_endpoint: '/api/pump/accept-payment-prep',
					hint:
						'POST a confirmed acceptPayment whose end_time > now() and tool_name matches this tool, then retry.',
				});
			}
			auth.subscription = sub;
		}
	}

	try {
		const result = await tool.handler(args, auth);
		recordEvent({
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
			latencyMs: Date.now() - started,
			meta: { args_summary: summarize(args) },
		});
		return result;
	} catch (err) {
		recordEvent({
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
			status: 'error',
			latencyMs: Date.now() - started,
			meta: { error: err.message },
		});
		// Only re-throw intentional JSON-RPC errors (integer codes); string codes are
		// postgres SQL states (e.g. '42P01') — sanitize those rather than leaking them.
		if (err.code && typeof err.code === 'number') throw err;
		// Framework convention: tool errors go in result.isError, not rpc error.
		// Detect postgres driver errors by their severity field and suppress internals.
		if (err.severity !== undefined || err.schema !== undefined) {
			log.error('tool_db_error', { tool: name, pg_code: err.code });
			return { content: [{ type: 'text', text: 'Error: internal error' }], isError: true };
		}
		return {
			content: [{ type: 'text', text: `Error: ${err.message || 'tool call failed'}` }],
			isError: true,
		};
	}
}
