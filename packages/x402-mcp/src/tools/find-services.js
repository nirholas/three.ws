// `find_services` — search the live x402 bazaar for paid services. Read-only.
//
// Wraps GET /api/bazaar/search, which merges the public facilitator discovery
// feeds (PayAI + CDP) and ranks them against your query. Feed a returned
// `resource` into pay_and_call to actually use it.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'find_services',
	title: 'Find paid x402 services the agent can call',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Search the live x402 facilitator network (PayAI + Coinbase CDP bazaar) for paid services (HTTP APIs and MCP tools). Returns each match with its price, networks, and resource URL. Use this when a task needs a paid API or tool you do not already have; to use a match, check its price with inspect_endpoint, then pass its resource into pay_and_call. Read-only.',
	inputSchema: {
		query: z.string().min(1).describe('What you need, e.g. "weather", "image upscale", "token intel".'),
		type: z.enum(['http', 'mcp']).default('http').describe('Service kind to search.'),
		network: z.string().optional().describe('CAIP-2 network filter, e.g. "solana:*" or "eip155:8453".'),
		max_price_usdc: z.number().min(0).optional().describe('Only return services at or under this USDC price.'),
		limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25).'),
	},
	async handler(args) {
		const query = String(args?.query ?? '').trim();
		const type = args?.type === 'mcp' ? 'mcp' : 'http';
		const maxPrice =
			args?.max_price_usdc != null ? String(Math.round(Number(args.max_price_usdc) * 1_000_000)) : undefined;
		const data = await apiRequest('/api/bazaar/search', {
			query: {
				query,
				type,
				network: args?.network,
				maxPrice,
				limit: args?.limit ?? 25,
			},
		});
		const resources = Array.isArray(data?.resources) ? data.resources : [];
		const services = resources.map((it) => ({
			resource: it.resource,
			name: it.serviceName || it.name || undefined,
			description: it.description || undefined,
			price: it.minPriceLabel || it.price || undefined,
			networks: it.networks,
			tool_name: it.toolName || undefined,
		}));
		return { ok: true, query, type, count: services.length, services };
	},
};
