// `agent_hire` — paid MCP tool that hires a three.ws agent transparently: it
// quotes the price up front, settles real USDC via the existing x402 facilitator,
// runs the remote agent, and returns its result PLUS a provenance receipt (which
// agent, its reputation, the amount paid, the settlement reference, the latency).
//
// Pricing: the platform delegation fee (MCP_AGENT_HIRE_PRICE_USD, default $0.05),
// settled `exact` in USDC on Solana mainnet — the SAME x402 path every paid tool
// uses. There is no mock settlement: a successful call settles real USDC, and the
// on-chain reference lands in the result _meta["x402/payment-response"].
//
// Guardrails (enforced BEFORE the remote agent runs, so a blocked call returns a
// clean error and the x402 wrapper cancels the payment — the caller is never
// charged for a refused or failed hire):
//   - hard per-call spend cap (+ optional caller maxSpendUsd, which can only
//     tighten it)
//   - per-session cumulative cap
//   - confirmation required above a threshold
//   - optional ERC-8004 reputation floor
//
// Step two of the agent-to-agent commerce loop (discover → hire). The receipt is
// rendered inline by the linked MCP App (commerce-ui.js) — trust through
// visibility.

import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { runDelegation } from '../lib/delegate-transport.js';
import { fetchAgentById, readAgentReputation, relevanceScore } from '../lib/agent-registry.js';
import {
	buildProvenance,
	evaluateSpendGuards,
	formatUsd,
	getSessionSpend,
	guardrailConfig,
	recordSessionSpend,
} from '../lib/agent-commerce.js';
import { UI_TOOL_META } from '../commerce-ui.js';

const TOOL_NAME = 'agent_hire';

// The headline price is the platform delegation fee resolved from env at build
// time (process env is static for a server's lifetime). This is the exact USDC
// the x402 wrapper charges, so the quote and the charge can never disagree.
const HIRE_PRICE_USD = guardrailConfig().hirePriceUsd;
const HIRE_PRICE_LABEL = formatUsd(HIRE_PRICE_USD);

const TOOL_DESCRIPTION =
	`Hire a three.ws agent end to end: quote the price up front, settle real USDC via x402, run the remote agent, and return its result PLUS a provenance receipt (agent, ERC-8004 reputation, amount paid, on-chain settlement reference, latency). Enforces hard spend caps (per-call + per-session), a confirmation threshold, and an optional reputation floor; a blocked or failed hire never charges the caller. Renders an inline receipt card. Step two of the commerce loop (after agent_hire_discover). Use this after agent_hire_discover, once you have chosen an agent and accept its quoted price. Paid: ${HIRE_PRICE_LABEL} USDC (the platform delegation fee).`;

function payToAddress() {
	for (const k of ['MCP_SVM_PAYMENT_ADDRESS', 'X402_PAY_TO_SOLANA', 'X402_PAY_TO']) {
		const v = process.env[k];
		if (v && v.trim()) return v.trim();
	}
	return null;
}

const inputZodShape = {
	agentId: z.string().min(1).max(120).describe('three.ws agent id (UUID) to hire.'),
	message: z.string().min(1).max(4000).describe('The task / message to delegate to the agent.'),
	model: z
		.string()
		.min(1)
		.max(100)
		.describe('Optional Claude model override (must be in the talk endpoint allowlist).')
		.optional(),
	maxSpendUsd: z
		.number()
		.min(0)
		.describe('Optional per-call spend ceiling (USD). Can only tighten the hard cap, never raise it.')
		.optional(),
	minReputation: z
		.number()
		.describe('Optional ERC-8004 reputation floor — refuse the hire if the agent is below it.')
		.optional(),
	confirm: z
		.boolean()
		.describe('Set true to authorize a hire at or above the confirmation threshold.')
		.optional(),
	sessionId: z
		.string()
		.min(1)
		.max(200)
		.describe('Optional sub-session id to scope the per-session spend cap (defaults to the connection).')
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildAgentHireTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: HIRE_PRICE_LABEL,
			inputSchema: inputJsonSchema,
			example: {
				agentId: '5a4b3c2d-1234-5678-90ab-cdef01234567',
				message: 'Summarise the latest pump.fun graduations in 3 bullets.',
				minReputation: 0.5,
			},
			outputExample: {
				ok: true,
				agentId: '5a4b3c2d-1234-5678-90ab-cdef01234567',
				agentName: 'Pump Sage',
				result: { response: '• …', model: 'claude-haiku-4-5-20251001', durationMs: 1840 },
				provenance: {
					agentName: 'Pump Sage',
					reputation: { average: 0.94, count: 12, source: 'erc8004', chain: 'Base' },
					payment: { amountDisplay: '$0.05', asset: 'USDC', networkLabel: 'Solana mainnet' },
					latencyMs: 1840,
				},
			},
		},
		async ({ agentId, message, model, maxSpendUsd, minReputation, confirm, sessionId }) => {
			const cfg = guardrailConfig();
			const price = cfg.hirePriceUsd;

			// 1) Spend guardrails — evaluated before anything else so a blocked hire
			//    cancels the payment (toolError → isError) and never runs the agent.
			const verdict = evaluateSpendGuards({
				priceUsd: price,
				maxSpendUsd,
				confirm,
				sessionId,
				config: cfg,
			});
			if (!verdict.allowed) {
				return toolError(verdict.code, verdict.message, {
					quotedPriceUsd: formatUsd(price),
					guardrails: verdict.limits,
				});
			}

			// 2) Resolve the agent + reputation (best-effort enrichment; also powers
			//    the optional reputation gate).
			const record = await fetchAgentById(agentId);
			const reputation = record ? await readAgentReputation(record) : null;
			const capabilityMatch =
				record && record.skills.length
					? relevanceScore(message, { name: record.name, description: record.description, skills: record.skills })
					: null;

			// 3) Reputation gate (only when a floor is requested). Fail closed: an
			//    explicit floor with no readable on-chain reputation refuses the hire.
			const floor =
				typeof minReputation === 'number'
					? minReputation
					: cfg.minReputation > 0
					? cfg.minReputation
					: null;
			if (floor != null) {
				const avg = reputation ? reputation.average : null;
				if (avg == null) {
					return toolError(
						'reputation_unavailable',
						`a reputation floor of ${floor} was set but ${record?.name || agentId} has no readable ERC-8004 reputation`,
						{ requestedMinReputation: floor },
					);
				}
				if (avg < floor) {
					return toolError(
						'reputation_below_threshold',
						`${record?.name || agentId} has ERC-8004 reputation ${avg.toFixed(2)}, below the requested floor of ${floor}`,
						{ requestedMinReputation: floor, reputation: { average: avg, count: reputation.count } },
					);
				}
			}

			// 4) Run the remote agent. NOT retried (non-idempotent). On failure we
			//    return a clean error → payment cancelled ("real value or none").
			const started = Date.now();
			const delegation = await runDelegation({ agentId, message, model });
			const latencyMs = Date.now() - started;
			if (!delegation.ok) {
				if (delegation.status === 0) {
					return toolError('upstream_unreachable', delegation.error || 'agent endpoint unreachable');
				}
				return toolError(
					delegation.error || 'agent_hire_failed',
					delegation.message || delegation.error || `endpoint returned ${delegation.status}`,
				);
			}

			const remote = delegation.data;
			const agentName = remote.agentName || record?.name || null;

			// 5) Provenance receipt + record the (about-to-settle) spend against the
			//    session ledger. The live on-chain settlement reference is attached
			//    by the x402 wrapper to result._meta — the card reads it from there.
			const provenance = buildProvenance({
				agentId,
				agentName,
				reputation,
				capabilityMatch,
				amountUsd: price,
				latencyMs,
				model: remote.model,
				payTo: payToAddress(),
				task: message,
			});
			const sessionSpentUsd = recordSessionSpend(sessionId, price, provenance);

			return {
				ok: true,
				agentId,
				agentName,
				result: {
					response: remote.response,
					model: remote.model,
					durationMs: remote.durationMs ?? latencyMs,
				},
				provenance,
				guardrails: {
					quotedPriceUsd: formatUsd(price),
					perCallCapUsd: formatUsd(verdict.limits.effectivePerCallUsd),
					sessionSpentUsd: formatUsd(sessionSpentUsd),
					sessionCapUsd: formatUsd(cfg.maxPerSessionUsd),
					sessionRemainingUsd: formatUsd(Math.max(0, cfg.maxPerSessionUsd - sessionSpentUsd)),
				},
				note: `Hired ${agentName || agentId}${
					reputation && reputation.average != null ? ` (rep ${reputation.average.toFixed(2)})` : ''
				} · paid ${formatUsd(price)} USDC · settlement reference in _meta["x402/payment-response"] · ${(
					latencyMs / 1000
				).toFixed(1)}s`,
				fetchedAt: new Date().toISOString(),
			};
		},
	);
	return {
		name: TOOL_NAME,
		title: `Agent hire (${HIRE_PRICE_LABEL})`,
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// MCP Apps: link to the provenance receipt card the host renders inline.
		_meta: UI_TOOL_META,
		// Spends USDC + runs a remote agent — a write with side effects, but it
		// never destroys existing state.
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
