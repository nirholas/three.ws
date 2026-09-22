// Credit metering for the tool gateway.
//
// Every gateway call draws from the caller's account credits, the same balance
// model calls use (api/_lib/credits.js), and lands as ordinary credit_ledger
// 'spend' rows with action `gateway.<tool>`. When the call runs for an agent the
// row carries ref_type 'agent' and the agent id, so the agent's daily and
// monthly budget (api/_lib/inference-billing.js) counts tool spend alongside
// model spend: one budget, one balance.
//
// The charge is taken BEFORE the tool runs, priced on what the request asks for
// (one search, 900 characters of speech, 6 seconds of video), which means an
// empty account is refused before any upstream is called. After the tool runs
// the charge is settled against what was actually produced (the real number of
// pages parsed, the real audio duration): a surplus is refunded, a small
// overage is debited. A tool that fails is refunded in full. Every movement is
// idempotent on the call id, so a retried request never double-charges.

import { debitCredits, refundCredits, getCreditAccount } from '../credits.js';
import { assertInferenceAllowed } from '../inference-billing.js';
import { recordEvent } from '../usage.js';
import { GATEWAY_PRICES, gatewayAction, priceGatewayCall, round6 } from './pricing.js';
import { GatewayError } from './errors.js';

export { GatewayError };

function ledgerRef(principal) {
	if (principal.agentId) return { refType: 'agent', refId: String(principal.agentId) };
	if (principal.apiKeyId) return { refType: 'account', refId: String(principal.apiKeyId) };
	return { refType: 'account', refId: null };
}

function insufficient(principal, err) {
	return new GatewayError(
		402,
		'insufficient_credits',
		'This account does not have enough credits for this tool call. Top up at https://three.ws/credits (or from an agent wallet with POST /api/agents/:id/credits/topup/preview), then retry.',
		{
			available_usd: Number(err?.available_usd ?? 0),
			required_usd: Number(err?.required_usd ?? 0),
			recover: principal.agentId
				? { action: 'topup', method: 'POST', path: `/api/agents/${principal.agentId}/credits/topup/preview` }
				: { action: 'topup', url: 'https://three.ws/credits' },
		},
	);
}

/**
 * Refund a gateway charge. Idempotent on (callId, reason).
 * @returns {Promise<number|null>} the balance after the refund
 */
export async function refundGatewayCharge({ principal, tool, callId, amountUsd, reason }) {
	const amt = round6(amountUsd);
	if (!(amt > 0)) return null;
	const r = await refundCredits({
		userId: principal.userId,
		amountUsd: amt,
		action: gatewayAction(tool),
		...ledgerRef(principal),
		idempotencyKey: `gateway:${callId}:${reason}`,
		meta: { tool, call_id: callId, reason, agent_id: principal.agentId ?? null },
	});
	return r?.balanceUsd ?? null;
}

/**
 * Admit, charge, run and settle one gateway call.
 *
 * @param {object} o
 * @param {{ userId: string, agentId?: string|null, agent?: object|null, apiKeyId?: string|null, clientId?: string|null, surface?: string }} o.principal
 * @param {string} o.tool                 a key of GATEWAY_PRICES
 * @param {number} o.estimateUnits        units the request asks for, charged up front
 * @param {string} o.callId               unique per logical call; the idempotency root
 * @param {() => Promise<{ result: object, units: number, provider?: string|null }>} o.run
 * @returns {Promise<{ result: object, billing: object }>}
 */
export async function meteredCall({ principal, tool, estimateUnits, callId, run }) {
	if (!principal?.userId) {
		throw new GatewayError(
			401,
			'unauthorized',
			'Gateway tools are billed to a three.ws account. Sign in, or send an API key (`Authorization: Bearer sk_live_...`).',
		);
	}
	if (!GATEWAY_PRICES[tool]) throw new GatewayError(404, 'unknown_tool', `No gateway tool named "${tool}".`);

	// An agent's owner-set budget refuses before anything is charged, and the
	// first refusal in a window stops its automations, exactly as for model calls.
	if (principal.agent) {
		try {
			await assertInferenceAllowed({ userId: principal.userId, agent: principal.agent });
		} catch (err) {
			if (err?.expose) throw new GatewayError(err.status, err.code, err.message, err.detail || null);
			throw err;
		}
	}

	const action = gatewayAction(tool);
	const ref = ledgerRef(principal);
	const started = Date.now();
	const preUsd = priceGatewayCall(tool, estimateUnits);
	const meta = { tool, call_id: callId, agent_id: principal.agentId ?? null, api_key_id: principal.apiKeyId ?? null, surface: principal.surface || null };

	let pre;
	try {
		pre = await debitCredits({
			userId: principal.userId,
			amountUsd: preUsd,
			action,
			...ref,
			idempotencyKey: `gateway:${callId}`,
			meta: { ...meta, units: estimateUnits, phase: 'authorize' },
		});
	} catch (err) {
		if (err?.code === 'insufficient_credits') throw insufficient(principal, err);
		throw err;
	}

	let out;
	try {
		out = await run();
	} catch (err) {
		await refundGatewayCharge({ principal, tool, callId, amountUsd: preUsd, reason: 'failed' }).catch((refundErr) =>
			console.error(`[tool-gateway] refund after failed ${tool} call ${callId} did not book:`, refundErr),
		);
		recordEvent({
			userId: principal.userId,
			apiKeyId: principal.apiKeyId ?? null,
			clientId: principal.clientId ?? null,
			agentId: principal.agentId ?? null,
			kind: 'tool_call',
			tool: action,
			status: 'error',
			latencyMs: Date.now() - started,
			meta: { call_id: callId, error: String(err?.message || err).slice(0, 300), refunded_usd: preUsd },
		});
		throw err;
	}

	const units = Number.isFinite(Number(out.units)) ? Number(out.units) : Number(estimateUnits);
	const finalUsd = priceGatewayCall(tool, units);
	let chargedUsd = pre.replay ? 0 : preUsd;
	let balanceUsd = pre.balanceUsd;
	let shortfallUsd = 0;

	if (!pre.replay && finalUsd < preUsd) {
		const back = round6(preUsd - finalUsd);
		balanceUsd = (await refundGatewayCharge({ principal, tool, callId, amountUsd: back, reason: 'settle' })) ?? balanceUsd;
		chargedUsd = finalUsd;
	} else if (!pre.replay && finalUsd > preUsd) {
		const extra = round6(finalUsd - preUsd);
		try {
			const r = await debitCredits({
				userId: principal.userId,
				amountUsd: extra,
				action,
				...ref,
				idempotencyKey: `gateway:${callId}:settle`,
				meta: { ...meta, units, phase: 'settle' },
			});
			balanceUsd = r.balanceUsd;
			chargedUsd = finalUsd;
		} catch (err) {
			if (err?.code !== 'insufficient_credits') throw err;
			// The work is done and delivered; the balance just could not cover the
			// measured overage. Report it rather than withhold the result.
			shortfallUsd = extra;
			balanceUsd = (await getCreditAccount(principal.userId)).balanceUsd;
		}
	}

	recordEvent({
		userId: principal.userId,
		apiKeyId: principal.apiKeyId ?? null,
		clientId: principal.clientId ?? null,
		agentId: principal.agentId ?? null,
		kind: 'tool_call',
		tool: action,
		latencyMs: Date.now() - started,
		provider: out.provider ?? null,
		costMicroUsd: Math.round(chargedUsd * 1e6),
		meta: { call_id: callId, units, billed_usd: chargedUsd, surface: principal.surface || null },
	});

	return {
		result: out.result,
		billing: {
			tool,
			call_id: callId,
			units: round6(units),
			unit: GATEWAY_PRICES[tool].unit,
			charged_usd: round6(chargedUsd),
			balance_usd: round6(balanceUsd),
			...(shortfallUsd > 0 ? { shortfall_usd: shortfallUsd } : {}),
			...(pre.replay ? { replay: true } : {}),
		},
	};
}
