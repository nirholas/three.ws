// `aixbt_projects` — paid MCP tool that returns aixbt's momentum-ranked
// projects (spiking / climbing / active scores, market metrics, and the most
// recent intel per project) so a three.ws agent can scan what's trending and
// reason about where attention is flowing.
//
// Pricing: $0.01 USDC, settled `exact` on Solana.
//
// Implementation: calls GET /api/aixbt/projects on the three.ws API surface,
// which holds the aixbt API key server-side.

import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { resilientFetch } from '../lib/resilient-fetch.js';

const TOOL_NAME = 'aixbt_projects';
const TOOL_DESCRIPTION =
	'aixbt momentum scan: projects ranked by aixbt spiking/climbing/active scores, with ticker, chain, market metrics (price, mcap, 24h volume + change) and recent intel. Filter by names (comma-separated) or chain. Powered by the live aixbt REST API. Use this to find which projects are gaining momentum; for the underlying narrative items, call aixbt_intel instead. Paid: $0.01 USDC.';

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
		.describe('Max projects to return (default 20).')
		.optional(),
	names: z
		.string()
		.max(256)
		.describe('Comma-separated project names/tickers to filter to.')
		.optional(),
	chain: z
		.string()
		.max(32)
		.describe('Filter to a chain (e.g. solana, base, ethereum).')
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildAixbtProjectsTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.01',
			inputSchema: inputJsonSchema,
			example: { limit: 10, chain: 'solana' },
			outputExample: {
				projects: [
					{
						name: 'three.ws',
						ticker: 'THREE',
						chain: 'solana',
						scores: { spiking: 0.91, climbing: 0.74, active: 0.88 },
						market: {
							price_usd: 0.00464,
							market_cap: null,
							volume_24h: null,
							change_24h: 45.9,
						},
						source: 'aixbt',
					},
				],
			},
		},
		async ({ limit, names, chain }) => {
			const base = env('MCP_AIXBT_BASE', 'https://three.ws');
			const url = new URL(`${base.replace(/\/$/, '')}/api/aixbt/projects`);
			if (limit) url.searchParams.set('limit', String(limit));
			if (names) url.searchParams.set('names', names);
			if (chain) url.searchParams.set('chain', chain);

			let res;
			try {
				res = await resilientFetch(
					url,
					{ headers: { accept: 'application/json' } },
					{ timeoutMs: 12_000, retries: 2, label: 'aixbt-projects' },
				);
			} catch (err) {
				return toolError('upstream_unreachable', err?.message || 'fetch failed');
			}
			const data = await res.json().catch(() => null);
			if (!res.ok || !data || data.error) {
				return toolError(
					data?.error || 'aixbt_projects_failed',
					data?.error_description || `endpoint returned ${res.status}`,
				);
			}
			return data;
		},
	);
	return {
		name: TOOL_NAME,
		title: 'aixbt projects ($0.01)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only live momentum rankings — scores shift continuously, so not
		// idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
