// POST /api/v1/chat/completions: the metered, OpenAI-compatible model endpoint.
//
// A drop-in base URL for any client that accepts one: point it at
// https://three.ws/api/v1, use a three.ws API key carrying the `inference`
// scope (POST /api/me/inference/provision mints one funded from an agent
// wallet), and ask for model `three-ws/agent`. The completion is the same
// server-side agent loop /api/agent/run serves (api/agent/run.js
// runAgentCompletion: free lanes first, the Vertex credits anchor last, the
// read-only tool registry), billed to the caller's account credits at the
// published rate (api/_lib/pricing/catalog.js INFERENCE_USD_PER_MTOK).
//
// A request that sends its own `tools` is answered as a plain tool-calling
// model instead: one round over the same lanes, with the model's tool_calls
// returned for the caller to execute (api/_lib/client-tool-round.js). That is
// how the local agent (packages/agent-cli) runs file, shell and MCP tools on
// its own machine while the tokens bill here.
//
// Billing, in order:
//   1. assertInferenceAllowed: 402 insufficient_credits when the account is
//      empty, 402 inference_budget_exhausted when the agent this call runs for
//      has used its daily or monthly budget (and that first refusal stops the
//      agent's automations and notifies the owner).
//   2. The completion runs.
//   3. chargeInference books one idempotent credit_ledger row for the summed
//      tokens of every model round. A failed completion is not charged.
//
// A caller with no key and no session can pay for the single request instead,
// over x402 `upto` on Solana (api/_lib/metered-router.js): the unauthenticated
// request is answered 402 with a cap sized to the model's worst case, the
// retry carries the signed payment, and the measured tokens times the model's
// published price are what settle; the rest of the cap is refunded.
//
// The agent a call runs for is the one the key was provisioned from
// (inference_keys), or the caller's own agent named by `agent_id` in the body
// or the `X-Three-Agent` header. Without an agent the call bills the account
// and no budget applies.

import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, error, method, rateLimited, readJson, setRateLimitHeaders, wrap } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { recordEvent } from '../../_lib/usage.js';
import {
	assertInferenceAllowed,
	chargeInference,
	INFERENCE_MODEL_ID,
} from '../../_lib/inference-billing.js';
import { runAgentCompletion } from '../../agent/run.js';
import { providerChain } from '../../_lib/llm-tool-chain.js';
import { runClientToolCompletion, sanitizeClientTools } from '../../_lib/client-tool-round.js';
import { clientIp } from '../../_lib/rate-limit.js';
import { inferenceModelRow } from '../../_lib/pricing/inference-models.js';
import {
	admitMeteredPayment,
	meteredAvailable,
	paymentHeaderOf,
	promptTokensOf,
	sendMeteredChallenge,
	settleMetered,
	watchStream,
} from '../../_lib/metered-router.js';

const MAX_BODY_BYTES = 512_000;

async function resolveCaller(req) {
	const bearerToken = extractBearer(req);
	if (bearerToken) {
		const bearer = await authenticateBearer(bearerToken);
		if (!bearer) return { error: [401, 'invalid_api_key', 'That API key or token is not valid, expired, or revoked.'] };
		if (!hasScope(bearer.scope, 'inference')) {
			return { error: [403, 'insufficient_scope', 'This key cannot call models. Mint one with the `inference` scope at /dashboard/api, or fund one from an agent wallet: npx three-ws fund --amount 5 --agent <id>.'] };
		}
		return { userId: bearer.userId, apiKeyId: bearer.apiKeyId || null, clientId: bearer.clientId || null };
	}
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, apiKeyId: null, clientId: null };
	if (meteredAvailable()) return { anonymous: true };
	return { error: [401, 'missing_api_key', 'Send a three.ws API key with the `inference` scope as `Authorization: Bearer sk_live_...`. The free, unmetered agent loop is POST /api/agent/run.'] };
}

async function resolveAgent(req, body, caller) {
	if (caller.apiKeyId) {
		const [bound] = await sql`
			SELECT i.id, i.user_id, i.name, i.meta
			FROM inference_keys k JOIN agent_identities i ON i.id = k.agent_id
			WHERE k.api_key_id = ${caller.apiKeyId} AND i.deleted_at IS NULL
		`;
		if (bound) return { agent: bound };
	}
	const named = body?.agent_id || req.headers['x-three-agent'] || null;
	if (!named) return { agent: null };
	if (!isUuid(String(named))) return { error: [400, 'bad_agent_id', 'agent_id must be the id of one of your agents.'] };
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${String(named)} AND deleted_at IS NULL
	`;
	if (!row || String(row.user_id) !== String(caller.userId)) {
		return { error: [404, 'agent_not_found', 'No agent with that id belongs to this account.'] };
	}
	return { agent: row };
}

// OpenAI-style error body, so an OpenAI SDK surfaces the message verbatim.
function openAiError(res, status, code, message, detail = {}) {
	return error(res, status, code, message, { type: code, code, ...detail });
}

// The pay-per-request lane: no key, no session, one request paid over x402
// `upto`. The cap is escrowed before any model call; the claim settles the
// measured tokens (or nothing, when the completion produced none).
async function handleMetered(req, res, body, row) {
	if (body?.agent_id || req.headers['x-three-agent']) {
		return openAiError(res, 401, 'sign_in_required', 'Naming an agent needs its owner: send an API key with the `inference` scope.');
	}
	let clientTools;
	try {
		clientTools = sanitizeClientTools(body?.tools);
	} catch (err) {
		return openAiError(res, err.status || 400, err.code || 'bad_tools', err.message);
	}
	const sizing = { clientTools: !!clientTools };
	if (!paymentHeaderOf(req)) return sendMeteredChallenge(res, row, body, sizing);

	const admitted = await admitMeteredPayment(req, res, row, body, sizing);
	if (admitted.challenge) return;
	const { session } = admitted;
	const promptTokens = promptTokensOf(body);
	const stream = watchStream(res, {
		onClose: ({ outputTokens }) => {
			if (session.settling) return;
			settleMetered(session, { inputTokens: promptTokens, outputTokens, reason: 'client_closed' }).catch((err) =>
				console.error('metered: claim after close failed', err?.message || err),
			);
		},
	});

	const onUsage = async (usage) => {
		const settled = await settleMetered(session, {
			inputTokens: usage.prompt_tokens,
			outputTokens: usage.completion_tokens,
		});
		if (!res.headersSent) {
			res.setHeader('x-payment-response', Buffer.from(JSON.stringify(settled)).toString('base64'));
		}
		return settled;
	};

	try {
		if (clientTools) {
			const chain = providerChain();
			if (!chain.length) {
				await settleMetered(session, { cancel: true, reason: 'no_lane' });
				return openAiError(res, 503, 'llm_unavailable', 'No model lane is configured right now. Try again shortly.');
			}
			await runClientToolCompletion(req, res, body, { chain, tools: clientTools, modelId: INFERENCE_MODEL_ID, onUsage });
		} else {
			await runAgentCompletion(req, res, body, { rateLimited: true, learning: null, onUsage });
		}
	} finally {
		if (!session.settling) {
			const sent = stream.outputTokensSoFar();
			await settleMetered(session, sent > 0
				? { inputTokens: promptTokens, outputTokens: sent, reason: 'partial' }
				: { cancel: true, reason: 'no_output' }).catch((err) => console.error('metered: final claim failed', err?.message || err));
		}
	}
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'POST, OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const caller = await resolveCaller(req);
	if (caller.error) return openAiError(res, ...caller.error);

	const rl = await limits.apiV1(
		caller.anonymous ? `ip:${clientIp(req)}` : caller.apiKeyId ? `key:${caller.apiKeyId}` : `user:${caller.userId}`,
	);
	setRateLimitHeaders(res, rl);
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = await readJson(req, MAX_BODY_BYTES);
	} catch (err) {
		return openAiError(res, err?.status || 400, 'bad_json', err?.message || 'Body must be JSON.');
	}
	const modelRow = inferenceModelRow(body?.model);
	if (!modelRow) {
		return openAiError(res, 404, 'model_not_found', `Model "${body.model}" is not served here. Use "${INFERENCE_MODEL_ID}" (GET /api/v1/models).`);
	}

	if (caller.anonymous) return handleMetered(req, res, body, modelRow);

	const resolved = await resolveAgent(req, body, caller);
	if (resolved.error) return openAiError(res, ...resolved.error);
	const agent = resolved.agent;

	try {
		await assertInferenceAllowed({ userId: caller.userId, agent });
	} catch (err) {
		if (err?.expose) return openAiError(res, err.status, err.code, err.message, err.detail || {});
		throw err;
	}

	// A request that brings its own `tools` gets one plain tool-calling round:
	// the model's tool_calls go back to the caller, whose runtime executes them
	// (api/_lib/client-tool-round.js). Validated before any spend.
	let clientTools;
	try {
		clientTools = sanitizeClientTools(body?.tools);
	} catch (err) {
		return openAiError(res, err.status || 400, err.code || 'bad_tools', err.message);
	}

	const started = Date.now();
	const onUsage = async (usage, completionId) => {
		const charge = await chargeInference({
			userId: caller.userId,
			agentId: agent?.id ?? null,
			apiKeyId: caller.apiKeyId,
			callId: completionId,
			inputTokens: usage.prompt_tokens,
			outputTokens: usage.completion_tokens,
			estimated: usage.estimated,
			provider: usage.lanes.at(-1)?.provider ?? null,
			model: usage.lanes.at(-1)?.model ?? null,
		});
		recordEvent({
			userId: caller.userId,
			apiKeyId: caller.apiKeyId,
			clientId: caller.clientId,
			agentId: agent?.id ?? null,
			kind: 'llm',
			tool: 'v1.chat.completions',
			latencyMs: Date.now() - started,
			provider: usage.lanes.at(-1)?.provider ?? null,
			model: usage.lanes.at(-1)?.model ?? null,
			inputTokens: usage.prompt_tokens,
			outputTokens: usage.completion_tokens,
			costMicroUsd: usage.cost_micro_usd,
			meta: { billed_usd: charge.chargedUsd, estimated: usage.estimated, rounds: usage.lanes.length },
		});
		return {
			charged_usd: charge.chargedUsd,
			balance_usd: charge.balanceUsd,
			agent_id: agent?.id ?? null,
			...(charge.shortfallUsd > 0 ? { shortfall_usd: charge.shortfallUsd } : {}),
		};
	};

	if (clientTools) {
		const chain = providerChain();
		if (!chain.length) return openAiError(res, 503, 'llm_unavailable', 'No model lane is configured right now. Try again shortly.');
		return runClientToolCompletion(req, res, body, { chain, tools: clientTools, modelId: INFERENCE_MODEL_ID, onUsage });
	}

	return runAgentCompletion(req, res, body, {
		rateLimited: true,
		// A completion billed to one of the caller's agents speaks as that agent:
		// its memory, its skills, and the learning loop (docs/agent-memory.md).
		learning: agent ? { agentId: String(agent.id), userId: String(caller.userId) } : null,
		onUsage,
	});
});
