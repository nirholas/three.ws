// `agent_delegate_action` — paid MCP tool that lets an external agent
// send a message to any three.ws-registered agent and get its reply.
//
// Pricing: $0.01 USDC, settled `exact` in USDC on Solana mainnet.
//
// Implementation: calls POST /api/agents/talk with the target agentId
// and message. The target's brain is driven by its embed_policy.brain
// settings on three.ws (which model, system prompt). Agents whose owner
// has set surfaces.mcp = false in their embed policy are refused.
//
// Recursion is prevented server-side via the x-delegate-depth header.

import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { runDelegation } from '../lib/delegate-transport.js';

const TOOL_NAME = 'agent_delegate_action';
const TOOL_DESCRIPTION =
	'Send a message to a three.ws-registered agent and receive its response. The target agent uses its configured brain (Claude model and system prompt set via its embed policy). Agents that have opted out of MCP delegation are refused. Use this for agent-to-agent collaboration when you already know which agent should answer; to find and pay an agent by task fit with a provenance receipt, use agent_hire_discover and then agent_hire instead. Paid: $0.01 USDC.';

// Single source of truth: Zod shape carries descriptions + bounds; JSON Schema
// derived. The prior hand-written JSON Schema left `model` with no bounds; the
// Zod (min 1, max 100) is stricter and now wins, surfacing those bounds in the
// advertised schema too.
const inputZodShape = {
	agentId: z.string().min(1).max(120).describe('three.ws agent id (UUID).'),
	message: z.string().min(1).max(4000),
	model: z
		.string()
		.min(1)
		.max(100)
		.describe(
			'Optional Claude model override (e.g. claude-sonnet-4-6). Must be in the allowlist.',
		)
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildAgentDelegateActionTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.01',
			inputSchema: inputJsonSchema,
			example: {
				agentId: '5a4b3c2d-1234-5678-90ab-cdef01234567',
				message: 'Summarise the latest pump.fun graduations in 3 bullets.',
			},
			outputExample: {
				ok: true,
				agentId: '5a4b3c2d-1234-5678-90ab-cdef01234567',
				agentName: 'Pump Sage',
				response: '...',
				model: 'claude-haiku-4-5-20251001',
				durationMs: 1840,
			},
		},
		async ({ agentId, message, model }) => {
			const result = await runDelegation({ agentId, message, model });
			if (!result.ok) {
				if (result.status === 0) {
					return toolError('upstream_unreachable', result.error || 'fetch failed');
				}
				return toolError(
					result.error || 'agent_delegate_failed',
					result.message || result.error || `endpoint returned ${result.status}`,
				);
			}
			return result.data;
		},
	);
	return {
		name: TOOL_NAME,
		title: 'Agent delegate action ($0.01)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Dispatches a delegated action to an external agent — a write with
		// side effects, but it never destroys existing state.
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
