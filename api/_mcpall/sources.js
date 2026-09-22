// The hosted MCP servers the unified endpoint (/mcp, /api/mcp/all) mounts.
//
// Each source adapts one existing server to a single shape, reading that
// server's own catalog, handlers, pricing and access rules. Nothing is copied:
// a tool added to /api/mcp-3d appears on /mcp the next time the process boots,
// with the same schema, the same handler and the same price, which is what
// makes the seven legacy endpoints and the unified one views of one registry.
//
// Source shape:
//   id            short id, also the resource server key where one exists
//   policyServer  the @three-ws/mcp-policy server id (== the catalog server id)
//   endpoint      the legacy endpoint path, still served
//   tools()       [{ def, scope, impl, run }] where def is the tools/list entry
//                 as that server publishes it, impl the underlying handler (two
//                 servers sharing one module share it), and run(args, auth, req)
//                 executes it with that server's scope check and validation
//   isPublic(n)   callable with no bearer and no payment on the legacy server
//   x402Amount(n, args)  atomic USDC price for an anonymous paid call, or null
//   before(n, ctx)       optional quota or rate gate; returns an MCP error
//                        result (isError) to refuse, or null to proceed

import { hasScope } from '../_lib/auth.js';
import { env } from '../_lib/env.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { x402AmountForTool, priceFor as mainPriceFor, resolveBillingMint } from '../_lib/pump-pricing.js';
import { declareMcpDiscovery } from '../_lib/x402/bazaar-helpers.js';
import { GETTING_STARTED_TOOL } from '../_lib/mcp-getting-started.js';
import { TOOL_CATALOG as MAIN_CATALOG, TOOLS as MAIN_TOOLS } from '../_mcp/catalog.js';
import { isPublicTool as isMainPublic } from '../_mcp/dispatch.js';
import { TOOL_CATALOG as STUDIO3D_CATALOG, TOOLS as STUDIO3D_TOOLS } from '../_mcp3d/catalog.js';
import { studioX402Amount } from '../_mcp3d/pricing.js';
import { TOOL_CATALOG as AGENT_CATALOG, TOOLS as AGENT_TOOLS } from '../_mcpagent/catalog.js';
import { TOOL_CATALOG as BAZAAR_CATALOG, TOOLS as BAZAAR_TOOLS } from '../_mcpbazaar/catalog.js';
import { TOOL_CATALOG as IBM_CATALOG, TOOLS as IBM_TOOLS, isFreeTool as isIbmFree } from '../_mcpibm/catalog.js';
import { graniteX402Amount } from '../_mcpibm/pricing.js';
import { toolCatalogFor as studioCatalogFor, toolsFor as studioToolsFor } from '../_mcp-studio/dispatch.js';
import { isGenerationTool } from '../_mcp-studio/handler.js';
import { listPumpFunTools, pumpFunToolEntry } from '../pump-fun-mcp.js';

/** An MCP tool error result the model can read and act on. */
export function toolError(text, structured) {
	return { content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}), isError: true };
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

/**
 * Run a { scope?, handler, validate? } entry the way the shared dispatchers do:
 * scope check, then argument validation, then the handler.
 */
function runner(entry, name) {
	return async (args, auth, req) => {
		if (entry.scope && !hasScope(auth.scope, entry.scope)) {
			throw rpcError(-32002, `insufficient scope, requires ${entry.scope}`, { scope: entry.scope });
		}
		if (entry.validate && !entry.validate(args)) {
			const first = entry.validate.errors?.[0];
			const detail = first ? `${first.instancePath || '(root)'} ${first.message || 'invalid'}` : 'invalid arguments';
			throw rpcError(-32602, `invalid params for ${name}: ${detail}`);
		}
		return entry.handler(args, auth, req);
	};
}

function fromCatalog(catalog, tools, { skip = () => false } = {}) {
	return catalog
		.filter((def) => def.name !== GETTING_STARTED_TOOL && !skip(def.name))
		.map((def) => ({
			def,
			scope: tools[def.name]?.scope || null,
			impl: tools[def.name]?.handler || null,
			run: runner(tools[def.name], def.name),
		}));
}

// The main server decorates a priced tool with its price and a Bazaar discovery
// extension on tools/list. The unified server publishes the same decoration.
function decorateMain(def) {
	const price = mainPriceFor(def.name);
	if (!price) return def;
	return {
		...def,
		pricing: {
			amount_usdc: price.amount_usdc,
			currency: 'USDC',
			description: price.description,
			scheme: 'pump-agent-payments',
			prep_endpoint: '/api/pump/accept-payment-prep',
			confirm_endpoint: '/api/pump/accept-payment-confirm',
			recipient_mint: resolveBillingMint(),
		},
		extensions: {
			bazaar: declareMcpDiscovery({
				toolName: def.name,
				description: def.description,
				transport: 'streamable-http',
				inputSchema: def.inputSchema,
			}),
		},
	};
}

// read_resource is served once, by the unified server itself, over every
// resource; each legacy copy reads only its own server's slice.
const OWN_TOOLS = new Set(['read_resource']);

export const SOURCES = [
	{
		id: 'mcp',
		policyServer: 'three.ws',
		title: 'three.ws',
		endpoint: '/api/mcp',
		tools: () =>
			fromCatalog(MAIN_CATALOG, MAIN_TOOLS, { skip: (n) => OWN_TOOLS.has(n) }).map((t) => ({ ...t, def: decorateMain(t.def) })),
		isPublic: (name) => isMainPublic(name),
		x402Amount: (name) => x402AmountForTool(name),
	},
	{
		id: 'mcp-3d',
		policyServer: 'threews-3d-studio',
		title: '3D Studio',
		endpoint: '/api/mcp-3d',
		tools: () => fromCatalog(STUDIO3D_CATALOG, STUDIO3D_TOOLS, { skip: (n) => OWN_TOOLS.has(n) }),
		isPublic: () => false,
		x402Amount: (name, args) => studioX402Amount(name, args),
	},
	{
		id: 'mcp-studio',
		policyServer: 'threews-3d-studio-free',
		title: '3D Studio (free)',
		endpoint: '/api/mcp-studio',
		tools: () => {
			const handlers = studioToolsFor('full');
			return studioCatalogFor('full').map((def) => ({
				def,
				scope: null,
				impl: handlers[def.name]?.handler || null,
				run: runner(handlers[def.name], def.name),
			}));
		},
		// Every free-studio tool is anonymous on its own endpoint.
		isPublic: () => true,
		x402Amount: () => null,
		// The same per-IP generation quota and platform-wide breaker the free
		// studio endpoint applies, so a second door never doubles the GPU budget.
		async before(name, { req }) {
			if (!isGenerationTool(name)) return null;
			const ip = clientIp(req);
			const checks = [
				[() => limits.studioGenBurst(ip), 'generation rate limit, slow down and try again shortly'],
				[() => limits.studioGenHourly(ip), 'hourly generation limit reached, try again later'],
				[() => limits.studioGenerateGlobal(), 'the free 3D studio is at capacity right now, please try again later'],
			];
			for (const [check, message] of checks) {
				const rl = await check();
				if (!rl.success) {
					const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
					return toolError(`${message} (retry in ${retryAfter}s).`, { ok: false, reason: 'rate_limited', retry_after: retryAfter });
				}
			}
			return null;
		},
	},
	{
		id: 'mcp-agent',
		policyServer: 'threews-agent',
		title: 'Agent wallet',
		endpoint: '/api/mcp-agent',
		tools: () => fromCatalog(AGENT_CATALOG, AGENT_TOOLS, { skip: (n) => OWN_TOOLS.has(n) }),
		isPublic: () => false,
		x402Amount: () => null,
	},
	{
		id: 'mcp-bazaar',
		policyServer: 'threews-x402-bazaar',
		title: 'x402 Bazaar',
		endpoint: '/api/mcp-bazaar',
		tools: () => fromCatalog(BAZAAR_CATALOG, BAZAAR_TOOLS, { skip: (n) => OWN_TOOLS.has(n) }),
		isPublic: () => false,
		x402Amount: () => null,
	},
	{
		id: 'pump-fun-mcp',
		policyServer: 'threews-pumpfun',
		title: 'pump.fun',
		endpoint: '/api/pump-fun-mcp',
		tools: () =>
			listPumpFunTools().map((def) => {
				const entry = pumpFunToolEntry(def.name);
				return {
					def,
					scope: null,
					impl: entry.handler,
					async run(args) {
						try {
							const data = await entry.handler(args && typeof args === 'object' ? args : {});
							return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
						} catch (err) {
							// The pump handlers signal designed failures with rpcCode
							// (-32004 indexer unavailable, -32602 bad input).
							if (err?.rpcCode) throw rpcError(err.rpcCode, err.message);
							throw err;
						}
					},
				};
			}),
		// The free read tools are anonymous; the gated ones (vanity grind, whale
		// and claim watches, metadata pinning) need a bearer or an x402 payment.
		isPublic: (name) => !pumpFunToolEntry(name)?.gated,
		x402Amount: (name) => (pumpFunToolEntry(name)?.gated ? env.X402_MAX_AMOUNT_REQUIRED : null),
		async before(name, { auth, req }) {
			if (!pumpFunToolEntry(name)?.gated) return null;
			const principal = auth.apiKeyId
				? `apikey:${auth.apiKeyId}`
				: auth.userId
					? `user:${auth.userId}`
					: auth.payer
						? `payer:${auth.payer}`
						: `ip:${clientIp(req)}`;
			const rl = await limits.mcpPumpGated(principal);
			if (!rl.success) return toolError('rate limit exceeded for gated tools', { ok: false, reason: 'rate_limited' });
			return null;
		},
		// A gated tool never runs for an anonymous principal.
		requiresPrincipal: (name) => Boolean(pumpFunToolEntry(name)?.gated),
	},
	{
		id: 'ibm-mcp',
		policyServer: 'ibm-x402-mcp-remote',
		title: 'IBM Granite',
		endpoint: '/api/ibm-mcp',
		tools: () => fromCatalog(IBM_CATALOG, IBM_TOOLS),
		isPublic: (name) => isIbmFree(name),
		x402Amount: (name) => graniteX402Amount(name),
	},
];

export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
