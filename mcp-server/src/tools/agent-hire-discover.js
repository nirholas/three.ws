// `agent_hire_discover` — paid MCP tool that, given a task description, finds
// candidate three.ws agents to hire, ranked by a composite of task fit, live
// ERC-8004 reputation, and real engagement, and quotes the up-front hire price.
//
// Pricing: $0.01 USDC, settled `exact` in USDC on Solana mainnet.
//
// This is step one of the legible agent-economy loop: discover → reputation-rank
// → hire (agent_hire). Every candidate comes from the live three.ws public
// directory; reputation is read straight from the canonical ERC-8004 registries
// — no mock data, no cached snapshots. The shortlist carries the reputation
// evidence behind each rank so the host model can choose transparently, plus the
// exact USDC price agent_hire will charge.

import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { fetchCandidates, rankCandidates } from '../lib/agent-registry.js';
import { guardrailConfig, formatUsd } from '../lib/agent-commerce.js';

const TOOL_NAME = 'agent_hire_discover';
const TOOL_DESCRIPTION =
	'Discover three.ws agents to hire for a task, ranked by task fit + live ERC-8004 on-chain reputation + real engagement. Returns a shortlist where each candidate carries its reputation evidence, capability/task-match score, and the exact USDC price agent_hire will settle. Optionally gate by a minimum reputation. Step one of the agent-to-agent commerce loop (discover → hire). Use this before agent_hire to pick a candidate and see the exact price it will settle. Paid: $0.01 USDC.';

const inputZodShape = {
	task: z
		.string()
		.min(3)
		.max(400)
		.describe('Plain-language description of the work to delegate (used to rank candidates).'),
	skill: z
		.string()
		.min(1)
		.max(64)
		.describe('Optional skill-slug filter (exact match against an agent\'s declared skills).')
		.optional(),
	limit: z
		.number()
		.int()
		.min(1)
		.max(10)
		.describe('Max candidates to return (default 5).')
		.optional(),
	minReputation: z
		.number()
		.describe('Optional floor: drop agents whose on-chain ERC-8004 average is below this.')
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildAgentHireDiscoverTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.01',
			inputSchema: inputJsonSchema,
			example: { task: 'summarise the latest pump.fun graduations in 3 bullets', limit: 5 },
			outputExample: {
				ok: true,
				task: 'summarise the latest pump.fun graduations',
				quotedHirePriceUsd: '$0.05',
				count: 1,
				candidates: [
					{
						agentId: '5a4b3c2d-1234-5678-90ab-cdef01234567',
						name: 'Pump Sage',
						score: 0.82,
						capabilityMatch: 0.75,
						reputation: { average: 0.94, count: 12, source: 'erc8004', chain: 'Base' },
						quotedPriceUsd: '$0.05',
						evidence: 'ERC-8004 reputation 0.94 across 12 vouch(es) on Base · task fit 75%',
					},
				],
			},
		},
		async ({ task, skill, limit, minReputation }) => {
			let candidates;
			try {
				candidates = await fetchCandidates({ q: task, skill, limit: 24 });
			} catch (err) {
				return toolError('registry_unreachable', err?.message || 'agent directory unavailable');
			}

			const cfg = guardrailConfig();
			const effectiveMin =
				typeof minReputation === 'number' ? minReputation : cfg.minReputation || undefined;

			const ranked = await rankCandidates({
				task,
				candidates,
				limit: limit || 5,
				minReputation: effectiveMin,
			});

			const quoted = formatUsd(cfg.hirePriceUsd);
			return {
				ok: true,
				task,
				skill: skill || null,
				minReputation: effectiveMin ?? null,
				quotedHirePriceUsd: quoted,
				count: ranked.length,
				candidates: ranked.map((c) => ({ ...c, quotedPriceUsd: quoted })),
				note:
					ranked.length === 0
						? 'No agents matched. Broaden the task wording or drop the skill/minReputation filter.'
						: `Hire any candidate with agent_hire — it will settle ${quoted} USDC and return a provenance receipt.`,
				fetchedAt: new Date().toISOString(),
			};
		},
	);
	return {
		name: TOOL_NAME,
		title: 'Agent hire: discover ($0.01)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only discovery: queries the live directory + on-chain reputation.
		// Rankings shift as engagement/reputation change, so not idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
