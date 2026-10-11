// `aixbt_intel` — paid MCP tool that surfaces aixbt's narrative intelligence
// feed (recent intel items: what's being said, where, and how reinforced) so a
// three.ws agent can react to live market narratives.
//
// Pricing: $0.01 USDC, settled `exact` on Solana.
//
// Implementation: calls GET /api/aixbt/intel on the three.ws API surface, which
// holds the aixbt API key server-side. This is the bridge the aixbt/three.ws
// thread described — agents tap aixbt intelligence over the same x402 rails.

import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { resilientFetch } from '../lib/resilient-fetch.js';

const TOOL_NAME = 'aixbt_intel';
const TOOL_DESCRIPTION =
	'aixbt narrative intelligence feed: recent intel items detected across crypto: category, description, observation count, official-source flag, and the project/ticker it concerns. Optionally filter by category or chain. Powered by the live aixbt REST API. Use this to see which narratives are forming right now; for a ranked list of projects with market metrics, call aixbt_projects instead. Paid: $0.01 USDC.';

function env(k, def) {
	const v = process.env[k];
	return v && String(v).trim() ? String(v).trim() : def;
}

const inputZodShape = {
	limit: z
		.number()
		.int()
		.min(1)
		.max(50)
		.describe('Max intel items to return (default 20).')
		.optional(),
	category: z.string().max(64).describe('Filter to a single aixbt intel category.').optional(),
	chain: z
		.string()
		.max(32)
		.describe('Filter to a chain (e.g. solana, base, ethereum).')
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildAixbtIntelTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.01',
			inputSchema: inputJsonSchema,
			example: { limit: 10, chain: 'solana' },
			outputExample: {
				intel: [
					{
						category: 'partnership',
						description: 'Protocol X integrates with aixbt intelligence feeds',
						observations: 12,
						official_source: true,
						project: 'three.ws',
						ticker: 'THREE',
						source: 'aixbt',
					},
				],
			},
		},
		async ({ limit, category, chain }) => {
			const base = env('MCP_AIXBT_BASE', 'https://three.ws');
			const url = new URL(`${base.replace(/\/$/, '')}/api/aixbt/intel`);
			if (limit) url.searchParams.set('limit', String(limit));
			if (category) url.searchParams.set('category', category);
			if (chain) url.searchParams.set('chain', chain);

			let res;
			try {
				res = await resilientFetch(
					url,
					{ headers: { accept: 'application/json' } },
					{ timeoutMs: 12_000, retries: 2, label: 'aixbt-intel' },
				);
			} catch (err) {
				return toolError('upstream_unreachable', err?.message || 'fetch failed');
			}
			const data = await res.json().catch(() => null);
			if (!res.ok || !data || data.error) {
				return toolError(
					data?.error || 'aixbt_intel_failed',
					data?.error_description || `endpoint returned ${res.status}`,
				);
			}
			return data;
		},
	);
	return {
		name: TOOL_NAME,
		title: 'aixbt intel ($0.01)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only live intelligence feed — narratives update continuously,
		// so not idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
