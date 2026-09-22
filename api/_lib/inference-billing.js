// Inference billing: model calls paid from account credits, capped per agent.
//
// The account's prepaid credits (api/_lib/credits.js, USD-denominated) are the
// one balance every model call on the metered endpoint draws from. An agent's
// wallet refills that balance (api/_lib/inference-topup.js), and an agent's
// owner can cap what its model calls may burn with a daily and a monthly
// inference budget (meta.inference_budget, set through PATCH /api/agents/:id).
//
// Three primitives, used by every metered model-call site:
//
//   assertInferenceAllowed()  BEFORE the call. Refuses with a typed 402 when
//                             the account is out of credits or the agent's
//                             budget is spent. The first refusal in a window
//                             stops the agent's automations and notifies the
//                             owner, so nothing keeps failing silently.
//   chargeInference()         AFTER the call. Prices the tokens at the
//                             published rate and debits one idempotent ledger
//                             row (action 'inference.agent', ref_type 'agent').
//   inferenceUsage()          The read model behind /api/me/usage, the agent
//                             credits tile and three://agents/{id}/usage.
//
// The budget is judged on spend already booked: a call that starts under the
// budget runs to completion and is charged in full. The next call is the one
// that refuses. That keeps a streamed answer from being cut mid-sentence while
// still guaranteeing the budget can be exceeded by at most one call.

import { sql } from './db.js';
import { getCreditAccount, debitCredits } from './credits.js';
import {
	INFERENCE_USD_PER_MTOK,
	INFERENCE_MIN_CALL_USD,
	USDC_CREDIT_RATE,
} from './pricing/catalog.js';
import { insertNotification } from './notify.js';
import { logAudit } from './audit.js';

export const INFERENCE_ACTION = 'inference.agent';
export const INFERENCE_MODEL_ID = 'three-ws/agent';

// A call is admitted only while the balance covers at least this much, so the
// post-call charge almost never finds the account empty.
export const MIN_BALANCE_TO_CALL_USD = 0.001;

// Upper bound on a budget value, far above any real daily model spend. It keeps
// a typo (an extra few zeros) from reading as "unlimited".
const MAX_BUDGET_USD = 100_000;

export class InferenceBillingError extends Error {
	constructor(status, code, message, detail = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
		this.expose = true;
	}
}

// ── pricing ─────────────────────────────────────────────────────────────────

/** Rough token count (about 4 characters per token) for text or JSON-able values. */
export function estimateTokens(value) {
	if (value == null) return 0;
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	return Math.ceil(text.length / 4);
}

/**
 * Price one model call at the published rate. Rounded UP to the micro-dollar
 * so the ledger never undercharges, and never below INFERENCE_MIN_CALL_USD.
 */
export function priceInference({ inputTokens = 0, outputTokens = 0 } = {}) {
	const input = Math.max(0, Number(inputTokens) || 0);
	const output = Math.max(0, Number(outputTokens) || 0);
	const raw = (input * INFERENCE_USD_PER_MTOK.input + output * INFERENCE_USD_PER_MTOK.output) / 1e6;
	const micro = Math.ceil(raw * 1e6 - 1e-9);
	return Math.max(INFERENCE_MIN_CALL_USD, micro / 1e6);
}

/** The published price sheet, for /api/v1/models, docs and the UI. */
export function inferencePricing() {
	return {
		model: INFERENCE_MODEL_ID,
		currency: 'USD',
		input_usd_per_mtok: INFERENCE_USD_PER_MTOK.input,
		output_usd_per_mtok: INFERENCE_USD_PER_MTOK.output,
		min_call_usd: INFERENCE_MIN_CALL_USD,
		usdc_credit_rate: USDC_CREDIT_RATE,
		topup_fee_usd: 0,
	};
}

// ── budgets ─────────────────────────────────────────────────────────────────

function budgetValue(v, field) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) {
		throw new InferenceBillingError(400, 'validation_error', `inferenceBudget.${field} must be a positive number of credits (USD), or null to remove it`);
	}
	if (n > MAX_BUDGET_USD) {
		throw new InferenceBillingError(400, 'validation_error', `inferenceBudget.${field} cannot exceed ${MAX_BUDGET_USD} credits`);
	}
	return Math.round(n * 1e6) / 1e6;
}

/**
 * Validate a client-supplied budget. Accepts `{ daily, monthly }` or
 * `{ daily_usd, monthly_usd }`; `null` (or both fields empty) clears it.
 * @returns {{ daily_usd: number|null, monthly_usd: number|null }|null}
 * @throws {InferenceBillingError} 400 on a malformed value
 */
export function normalizeInferenceBudget(raw) {
	if (raw === null) return null;
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		throw new InferenceBillingError(400, 'validation_error', 'inferenceBudget must be an object like { "daily": 1, "monthly": 20 } or null');
	}
	const daily = budgetValue(raw.daily ?? raw.daily_usd, 'daily');
	const monthly = budgetValue(raw.monthly ?? raw.monthly_usd, 'monthly');
	if (daily == null && monthly == null) return null;
	if (daily != null && monthly != null && daily > monthly) {
		throw new InferenceBillingError(400, 'validation_error', 'inferenceBudget.daily cannot be larger than inferenceBudget.monthly');
	}
	return { daily_usd: daily, monthly_usd: monthly };
}

/** The stored budget on an agent's meta, or null when none is set. */
export function getInferenceBudget(meta) {
	const b = meta?.inference_budget;
	if (!b || typeof b !== 'object') return null;
	const daily = Number(b.daily_usd);
	const monthly = Number(b.monthly_usd);
	const out = {
		daily_usd: Number.isFinite(daily) && daily > 0 ? daily : null,
		monthly_usd: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
	};
	return out.daily_usd == null && out.monthly_usd == null ? null : out;
}

/** UTC window keys: the day and the month a budget window is judged in. */
export function windowKeys(now = new Date()) {
	const iso = now.toISOString();
	return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

/**
 * Merge a validated budget into an agent's meta. Changing the budget clears a
 * recorded exhaustion, so raising it is all an owner has to do to recover.
 */
export function applyInferenceBudget(meta, budget) {
	const next = { ...(meta || {}) };
	if (budget == null) {
		delete next.inference_budget;
		return next;
	}
	next.inference_budget = {
		daily_usd: budget.daily_usd,
		monthly_usd: budget.monthly_usd,
		updated_at: new Date().toISOString(),
	};
	return next;
}

/** Inference credits an agent has burned today and this month (UTC). */
export async function agentInferenceSpend(agentId) {
	const [row] = await sql`
		SELECT
			COALESCE(SUM(-amount_usd) FILTER (
				WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
			), 0)::float8 AS today,
			COALESCE(SUM(-amount_usd), 0)::float8 AS month,
			COUNT(*) FILTER (
				WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
			)::int AS calls_today
		FROM credit_ledger
		WHERE action = ${INFERENCE_ACTION} AND ref_type = 'agent' AND ref_id = ${String(agentId)}
		  AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
	`;
	return {
		today_usd: round6(row?.today),
		month_usd: round6(row?.month),
		calls_today: Number(row?.calls_today || 0),
	};
}

function round6(n) {
	return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

/** Which budget window (if any) the current spend has used up. */
export function exhaustedWindow(budget, spend) {
	if (!budget) return null;
	if (budget.daily_usd != null && spend.today_usd >= budget.daily_usd - 1e-9) return 'daily';
	if (budget.monthly_usd != null && spend.month_usd >= budget.monthly_usd - 1e-9) return 'monthly';
	return null;
}

// ── the pre-call gate ───────────────────────────────────────────────────────

/**
 * Admit or refuse one model call.
 *
 * @param {object} p
 * @param {string} p.userId           the account whose credits pay
 * @param {object|null} [p.agent]     { id, name, meta, user_id } when the call runs for an agent
 * @returns {Promise<{ balanceUsd: number, budget: object|null, spend: object|null }>}
 * @throws {InferenceBillingError} 402 insufficient_credits | inference_budget_exhausted
 */
export async function assertInferenceAllowed({ userId, agent = null }) {
	const acct = await getCreditAccount(userId);
	if (acct.balanceUsd < MIN_BALANCE_TO_CALL_USD) {
		throw new InferenceBillingError(
			402,
			'insufficient_credits',
			'This account is out of credits. Top up from an agent wallet (POST /api/agents/:id/credits/topup/preview) or at https://three.ws/credits, then retry.',
			{
				balance_usd: acct.balanceUsd,
				recover: agent
					? { action: 'topup', method: 'POST', path: `/api/agents/${agent.id}/credits/topup/preview` }
					: { action: 'topup', url: 'https://three.ws/credits' },
			},
		);
	}
	if (!agent) return { balanceUsd: acct.balanceUsd, budget: null, spend: null };

	const budget = getInferenceBudget(agent.meta);
	if (!budget) return { balanceUsd: acct.balanceUsd, budget: null, spend: null };

	const spend = await agentInferenceSpend(agent.id);
	const window = exhaustedWindow(budget, spend);
	if (window) {
		const limit = window === 'daily' ? budget.daily_usd : budget.monthly_usd;
		const spent = window === 'daily' ? spend.today_usd : spend.month_usd;
		const stopped = await recordBudgetExhausted({ agent, userId, window, limit, spent });
		throw new InferenceBillingError(
			402,
			'inference_budget_exhausted',
			`${agent.name || 'This agent'} has used its ${window} inference budget ($${spent.toFixed(4)} of $${limit.toFixed(4)}). Raise inferenceBudget.${window === 'daily' ? 'daily' : 'monthly'} with PATCH /api/agents/${agent.id}, or wait for the ${window === 'daily' ? 'next UTC day' : 'next UTC month'}.`,
			{
				agent_id: agent.id,
				window,
				budget_usd: limit,
				spent_usd: spent,
				automations_stopped: stopped,
				resets_at: nextReset(window),
				recover: {
					action: 'raise_budget',
					method: 'PATCH',
					path: `/api/agents/${agent.id}`,
					body: { inferenceBudget: { [window === 'daily' ? 'daily' : 'monthly']: suggestedBudget(limit, spent) } },
				},
			},
		);
	}
	return { balanceUsd: acct.balanceUsd, budget, spend };
}

/** A raised budget that actually readmits calls: double the old one, and never below 1.5x what is already spent. */
export function suggestedBudget(limit, spent) {
	return round6(Math.max(limit * 2, spent * 1.5));
}

function nextReset(window, now = new Date()) {
	if (window === 'daily') {
		return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
	}
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * Record the first refusal in a window, exactly once: stamp the exhaustion on
 * the agent, stop its automations (agent status 'stopped', autopilot off) and
 * notify the owner. A second refusal in the same window changes nothing.
 * @returns {Promise<boolean>} whether the agent's automations are stopped
 */
async function recordBudgetExhausted({ agent, userId, window, limit, spent }) {
	const keys = windowKeys();
	const key = window === 'daily' ? keys.day : keys.month;
	const stamp = { window, key, at: new Date().toISOString(), budget_usd: limit, spent_usd: spent };

	// The WHERE clause is the once-per-window latch: only the request that flips
	// the stamp gets a row back, so concurrent refusals notify exactly once.
	const [won] = await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(
				jsonb_set(
					COALESCE(meta, '{}'::jsonb),
					'{inference_budget,exhausted}',
					${JSON.stringify(stamp)}::jsonb,
					true
				),
				'{autopilot,enabled}',
				'false'::jsonb,
				COALESCE(meta ? 'autopilot', false)
			),
			updated_at = now()
		WHERE id = ${agent.id}
		  AND meta ? 'inference_budget'
		  AND COALESCE(meta #>> '{inference_budget,exhausted,key}', '') <> ${key}
		RETURNING id
	`;
	if (!won) return true;

	const stopped = await stopAgentAutomations(agent.id);
	insertNotification(userId, 'inference_budget_exhausted', {
		agent_id: agent.id,
		agent_name: agent.name || null,
		window,
		budget_usd: limit,
		spent_usd: spent,
		automations_stopped: stopped,
		link: `/agent/${agent.id}#credits`,
	});
	logAudit({
		userId,
		action: 'inference.budget_exhausted',
		resourceId: agent.id,
		meta: { window, budget_usd: limit, spent_usd: spent, automations_stopped: stopped },
	});
	return stopped;
}

/**
 * Put the agent in the 'stopped' lifecycle state, which pauses its scheduled
 * automations, wallet intents and runs without deleting anything. Returns false
 * when the lifecycle column is not in this database yet (the automations
 * engine that reads it ships in the same release), so the refusal still lands.
 */
async function stopAgentAutomations(agentId) {
	try {
		await sql`
			UPDATE agent_identities
			SET status = 'stopped', status_changed_at = now(),
			    meta = jsonb_set(meta, '{inference_budget,exhausted,stopped_agent}', 'true'::jsonb, true)
			WHERE id = ${agentId} AND status = 'running'
		`;
		return true;
	} catch (err) {
		if (err?.code === '42703') return false;
		throw err;
	}
}

/**
 * Resume an agent this module stopped, once its owner has changed the budget.
 * Only an agent whose stop was recorded as ours is restarted; an agent the
 * owner stopped by hand stays stopped.
 */
export async function resumeAfterBudgetChange(agentId, previousMeta) {
	if (previousMeta?.inference_budget?.exhausted?.stopped_agent !== true) return false;
	try {
		const rows = await sql`
			UPDATE agent_identities SET status = 'running', status_changed_at = now()
			WHERE id = ${agentId} AND status = 'stopped'
			RETURNING id
		`;
		return rows.length > 0;
	} catch (err) {
		if (err?.code === '42703') return false;
		throw err;
	}
}

// ── the post-call charge ────────────────────────────────────────────────────

/**
 * Debit one model call. Idempotent on `callId`. When the balance cannot cover
 * the full price (the call was admitted with a thin balance), the remaining
 * balance is taken instead and the shortfall reported, never a negative balance.
 *
 * @returns {Promise<{ chargedUsd: number, pricedUsd: number, balanceUsd: number, shortfallUsd: number, replay: boolean }>}
 */
export async function chargeInference({
	userId,
	agentId = null,
	apiKeyId = null,
	callId,
	inputTokens,
	outputTokens,
	estimated = false,
	provider = null,
	model = null,
}) {
	const pricedUsd = priceInference({ inputTokens, outputTokens });
	const meta = {
		model: INFERENCE_MODEL_ID,
		agent_id: agentId,
		api_key_id: apiKeyId,
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		estimated,
		lane: provider,
		lane_model: model,
	};
	const base = {
		userId,
		action: INFERENCE_ACTION,
		refType: agentId ? 'agent' : 'account',
		refId: agentId ? String(agentId) : apiKeyId ? String(apiKeyId) : null,
		idempotencyKey: `inference:${callId}`,
		meta,
	};
	try {
		const r = await debitCredits({ ...base, amountUsd: pricedUsd });
		return { chargedUsd: r.chargedUsd, pricedUsd, balanceUsd: r.balanceUsd, shortfallUsd: 0, replay: r.replay };
	} catch (err) {
		if (err?.code !== 'insufficient_credits') throw err;
		const available = Number(err.available_usd) || 0;
		if (available <= 0) {
			return { chargedUsd: 0, pricedUsd, balanceUsd: 0, shortfallUsd: pricedUsd, replay: false };
		}
		const r = await debitCredits({
			...base,
			amountUsd: available,
			meta: { ...meta, priced_usd: pricedUsd, shortfall_usd: round6(pricedUsd - available) },
		});
		return {
			chargedUsd: r.chargedUsd,
			pricedUsd,
			balanceUsd: r.balanceUsd,
			shortfallUsd: round6(pricedUsd - available),
			replay: r.replay,
		};
	}
}

// ── the read model ──────────────────────────────────────────────────────────

/**
 * Credits, burn rate, days remaining and recent top-ups, for the whole account
 * or one agent. Burn rate is the trailing seven-day average of inference spend.
 */
export async function inferenceUsage({ userId, agent = null }) {
	const agentId = agent?.id ?? null;
	const [acct, burnRow, topups, monthRow] = await Promise.all([
		getCreditAccount(userId),
		sql`
			SELECT COALESCE(SUM(-amount_usd), 0)::float8 AS spent7,
			       COUNT(*)::int AS calls7
			FROM credit_ledger
			WHERE user_id = ${userId} AND action = ${INFERENCE_ACTION}
			  AND (${agentId}::text IS NULL OR (ref_type = 'agent' AND ref_id = ${agentId ? String(agentId) : null}))
			  AND created_at > now() - interval '7 days'
		`,
		sql`
			SELECT id, agent_id, source, status, amount_usdc, credits_usd, signature, error,
			       created_at, settled_at
			FROM inference_topups
			WHERE user_id = ${userId}
			  AND status IN ('settled', 'pending', 'failed', 'executing')
			  AND (${agentId}::uuid IS NULL OR agent_id = ${agentId})
			ORDER BY created_at DESC
			LIMIT 10
		`,
		sql`
			SELECT COALESCE(SUM(-amount_usd), 0)::float8 AS spent,
			       COUNT(*)::int AS calls,
			       COALESCE(SUM((meta->>'input_tokens')::bigint), 0)::bigint AS input_tokens,
			       COALESCE(SUM((meta->>'output_tokens')::bigint), 0)::bigint AS output_tokens
			FROM credit_ledger
			WHERE user_id = ${userId} AND action = ${INFERENCE_ACTION}
			  AND (${agentId}::text IS NULL OR (ref_type = 'agent' AND ref_id = ${agentId ? String(agentId) : null}))
			  AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
		`,
	]);

	const spent7 = Number(burnRow[0]?.spent7 || 0);
	const burnPerDay = round6(spent7 / 7);
	const out = {
		balance_usd: acct.balanceUsd,
		lifetime_deposited_usd: acct.lifetimeDepositedUsd,
		lifetime_spent_usd: acct.lifetimeSpentUsd,
		burn_rate_usd_per_day: burnPerDay,
		days_remaining: burnPerDay > 0 ? Math.floor((acct.balanceUsd / burnPerDay) * 10) / 10 : null,
		inference_month: {
			spent_usd: round6(monthRow[0]?.spent),
			calls: Number(monthRow[0]?.calls || 0),
			input_tokens: Number(monthRow[0]?.input_tokens || 0),
			output_tokens: Number(monthRow[0]?.output_tokens || 0),
		},
		calls_7d: Number(burnRow[0]?.calls7 || 0),
		pricing: inferencePricing(),
		topups: topups.map((t) => ({
			id: t.id,
			agent_id: t.agent_id,
			source: t.source,
			status: t.status,
			amount_usdc: Number(t.amount_usdc),
			credits_usd: Number(t.credits_usd),
			signature: t.signature,
			explorer_url: t.signature ? `https://solscan.io/tx/${t.signature}` : null,
			error: t.error,
			created_at: t.created_at,
			settled_at: t.settled_at,
		})),
	};

	if (agent) {
		const budget = getInferenceBudget(agent.meta);
		const spend = await agentInferenceSpend(agent.id);
		const window = exhaustedWindow(budget, spend);
		out.agent = {
			id: agent.id,
			name: agent.name || null,
			budget,
			spend,
			exhausted: window
				? { window, resets_at: nextReset(window), stopped: agent.meta?.inference_budget?.exhausted?.stopped_agent === true }
				: null,
		};
		out.auto_fund = await autoFundIntent(agent.id);
	}
	return out;
}

/** The agent's credits_below / fund_inference rule, as the UI toggle shows it. */
export async function autoFundIntent(agentId) {
	const [row] = await sql`
		SELECT id, enabled, trigger_config, action_config, limits, last_fired_at, last_status, last_note, last_signature
		FROM agent_wallet_intents
		WHERE agent_id = ${agentId} AND trigger_type = 'credits_below' AND action_type = 'fund_inference'
		ORDER BY created_at DESC
		LIMIT 1
	`;
	if (!row) return null;
	return {
		intent_id: row.id,
		enabled: row.enabled,
		threshold_usd: Number(row.trigger_config?.threshold_usd ?? 0),
		amount_usdc: Number(row.action_config?.amount_usdc ?? 0),
		limits: row.limits || {},
		last_fired_at: row.last_fired_at,
		last_status: row.last_status,
		last_note: row.last_note,
		last_signature: row.last_signature,
	};
}
