// Credit plans and trials for paid MCP tools.
//
// A paid tool is billed per call over x402 (api/_lib/pump-pricing.js). An account
// that would rather prepay buys a plan (api/_lib/mcp-plans.js): a credit bundle
// or a time pass. This module is the meter the MCP dispatcher runs around every
// tool call that has a price:
//
//   1. begin   - find what pays for the call, in this order:
//                  a time pass covering the tool (free while it lasts),
//                  a credit bundle with enough credits (debited atomically),
//                  a metered free trial (N calls per account per tool).
//   2. refund  - a tool that throws or answers isError gives the charge back.
//   3. finish  - settle a result-dependent cost, then report creditsUsed and
//                creditsRemaining in the result's _meta.
//
// When nothing covers the call, an account that holds a plan (or every account,
// with MCP_METER_ALL=1) gets the same -32402 the per-call x402 path raises, so a
// drained balance degrades to pay-per-call instead of a dead end. Accounts that
// never bought a plan keep today's behaviour: an OAuth bearer bypasses payment.
//
// One credit is worth $0.001 of a tool's per-call price. Credits live in
// mcp_plan_balances; a balance debit is a single conditional UPDATE so a spend
// can never drive it negative under concurrent calls.

import { sql } from './db.js';
import { logger } from './usage.js';
import { priceFor } from './pump-pricing.js';

const log = logger('mcp-credits');

export const CREDIT_USD = 0.001;
const DEFAULT_TRIAL_CALLS = 3;

// Tools whose cost is not simply their list price. `base` is debited before the
// call; `settle(result, args)` returns the final cost once the result is known,
// and the difference is debited or refunded. Empty today: every metered tool
// costs its list price in credits.
export const CREDIT_COST_OVERRIDES = Object.freeze({});

export function trialCallsPerTool(env = process.env) {
	const n = Number(env.MCP_TRIAL_CALLS);
	return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TRIAL_CALLS;
}

function meterAllAccounts(env = process.env) {
	return env.MCP_METER_ALL === '1' || env.MCP_METER_ALL === 'true';
}

/** Credits a tool call costs up front, or null when the tool is not metered. */
export function creditCostFor(toolName, args = {}) {
	const override = CREDIT_COST_OVERRIDES[toolName];
	if (override) {
		const base = typeof override.base === 'function' ? override.base(args) : override.base;
		return Math.max(1, Math.round(base));
	}
	const price = priceFor(toolName);
	if (!price || !(price.amount_usdc > 0)) return null;
	return Math.max(1, Math.round(price.amount_usdc / CREDIT_USD));
}

async function creditsRemaining(userId) {
	const [row] = await sql`
		select coalesce(sum(credits_remaining), 0)::int as remaining
		from mcp_plan_balances
		where user_id = ${userId} and kind = 'credits'
		  and (expires_at is null or expires_at > now())
	`;
	return row?.remaining ?? 0;
}

async function activeTimePass(userId, tool) {
	const [row] = await sql`
		select id, expires_at from mcp_plan_balances
		where user_id = ${userId} and kind = 'time' and expires_at > now()
		  and (cardinality(tools) = 0 or ${tool} = any(tools))
		order by expires_at desc
		limit 1
	`;
	return row || null;
}

async function debitBundle(userId, tool, cost) {
	const rows = await sql`
		with pick as (
			select id from mcp_plan_balances
			where user_id = ${userId} and kind = 'credits'
			  and credits_remaining >= ${cost}
			  and (expires_at is null or expires_at > now())
			  and (cardinality(tools) = 0 or ${tool} = any(tools))
			order by created_at
			limit 1
			for update skip locked
		), upd as (
			update mcp_plan_balances b
			set credits_remaining = b.credits_remaining - ${cost}
			from pick where b.id = pick.id
			returning b.id
		), ev as (
			insert into mcp_credit_events (user_id, balance_id, tool, kind, credits)
			select ${userId}, id, ${tool}, 'debit', ${cost} from upd
		)
		select id from upd
	`;
	return rows[0]?.id ?? null;
}

async function takeTrialUse(userId, tool, limit) {
	if (limit <= 0) return null;
	const rows = await sql`
		with t as (
			insert into mcp_tool_trials (user_id, tool, used)
			values (${userId}, ${tool}, 1)
			on conflict (user_id, tool) do update
				set used = mcp_tool_trials.used + 1, updated_at = now()
				where mcp_tool_trials.used < ${limit}
			returning used
		), ev as (
			insert into mcp_credit_events (user_id, tool, kind, credits)
			select ${userId}, ${tool}, 'trial', 0 from t
		)
		select used from t
	`;
	return rows[0] ? limit - rows[0].used : null;
}

async function holdsAnyPlan(userId) {
	const [row] = await sql`select 1 as held from mcp_plan_balances where user_id = ${userId} limit 1`;
	return Boolean(row);
}

function paymentRequired(rpcError, tool, cost, remaining, trialLimit) {
	const price = priceFor(tool);
	return rpcError(-32402, 'payment required for this tool', {
		scheme: 'x402',
		tool,
		amount_usdc: price?.amount_usdc,
		creditsRequired: cost,
		creditsRemaining: remaining,
		trialCalls: trialLimit,
		plans_url: '/mcp-plans',
		hint: 'Buy a credit plan at /mcp-plans, or call without a bearer token and pay this call over x402.',
	});
}

/**
 * Charge the account for a metered call. Returns a meter handle, or null when
 * the call is not metered (anonymous x402 principal, free tool, account without
 * a plan). Throws the rpcError built by `rpcError` when nothing covers the call.
 */
export async function beginMeter({ auth, tool, args, rpcError }) {
	const userId = auth?.userId;
	if (!userId || auth.x402Paid) return null;
	const cost = creditCostFor(tool, args);
	if (cost === null) return null;

	try {
		const pass = await activeTimePass(userId, tool);
		if (pass) {
			await sql`insert into mcp_credit_events (user_id, balance_id, tool, kind, credits) values (${userId}, ${pass.id}, ${tool}, 'time_pass', 0)`;
			return { userId, tool, cost, source: 'time_pass', balanceId: pass.id, paid: 0, expiresAt: pass.expires_at };
		}
		const balanceId = await debitBundle(userId, tool, cost);
		if (balanceId) return { userId, tool, cost, source: 'plan', balanceId, paid: cost };

		const trialLimit = trialCallsPerTool();
		const left = await takeTrialUse(userId, tool, trialLimit);
		if (left !== null) return { userId, tool, cost, source: 'trial', balanceId: null, paid: 0, trialRemaining: left };

		if (meterAllAccounts() || (await holdsAnyPlan(userId))) {
			throw paymentRequired(rpcError, tool, cost, await creditsRemaining(userId), trialLimit);
		}
		return null;
	} catch (err) {
		if (typeof err?.code === 'number') throw err;
		log.error('meter_begin_failed', { tool, message: err?.message });
		return null;
	}
}

/** Give back what beginMeter took. Safe to call once per meter. */
export async function refundMeter(meter) {
	if (!meter || meter.refunded) return;
	meter.refunded = true;
	try {
		if (meter.source === 'plan') {
			await sql`
				with upd as (
					update mcp_plan_balances set credits_remaining = credits_remaining + ${meter.paid}
					where id = ${meter.balanceId}
					returning id
				)
				insert into mcp_credit_events (user_id, balance_id, tool, kind, credits)
				select ${meter.userId}, id, ${meter.tool}, 'refund', ${meter.paid} from upd
			`;
			meter.paid = 0;
		} else if (meter.source === 'trial') {
			await sql`
				update mcp_tool_trials set used = greatest(used - 1, 0), updated_at = now()
				where user_id = ${meter.userId} and tool = ${meter.tool}
			`;
			meter.trialRemaining += 1;
		}
	} catch (err) {
		meter.refunded = false;
		log.error('meter_refund_failed', { tool: meter.tool, message: err?.message });
	}
}

async function settleCost(meter, result, args) {
	const override = CREDIT_COST_OVERRIDES[meter.tool];
	if (meter.refunded || meter.source !== 'plan' || typeof override?.settle !== 'function') return;
	const final = Math.max(0, Math.round(override.settle(result, args)));
	const delta = final - meter.paid;
	if (delta === 0) return;
	const [row] = await sql`
		with old as (select credits_remaining as before from mcp_plan_balances where id = ${meter.balanceId} for update),
		upd as (
			update mcp_plan_balances set credits_remaining = greatest(0, credits_remaining - ${delta})
			where id = ${meter.balanceId}
			returning credits_remaining as after
		), ev as (
			insert into mcp_credit_events (user_id, balance_id, tool, kind, credits)
			select ${meter.userId}, ${meter.balanceId}, ${meter.tool},
			       case when ${delta} > 0 then 'debit' else 'refund' end,
			       abs((select before from old) - upd.after)
			from upd
			where (select before from old) <> upd.after
		)
		select (select before from old) as before, upd.after from upd
	`;
	if (row) meter.paid += row.before - row.after;
}

/** Settle a result-dependent cost and attach creditsUsed / creditsRemaining. */
export async function finishMeter(meter, result, args) {
	if (!meter || !result || typeof result !== 'object') return result;
	try {
		await settleCost(meter, result, args);
	} catch (err) {
		log.error('meter_settle_failed', { tool: meter.tool, message: err?.message });
	}
	let remaining = null;
	try {
		remaining = await creditsRemaining(meter.userId);
	} catch (err) {
		log.error('meter_balance_failed', { tool: meter.tool, message: err?.message });
	}
	const meta = {
		creditsUsed: meter.paid,
		creditsRemaining: remaining,
		creditSource: meter.source,
		...(meter.source === 'trial' ? { trialRemaining: meter.trialRemaining } : {}),
		...(meter.source === 'time_pass' ? { planExpiresAt: new Date(meter.expiresAt).toISOString() } : {}),
	};
	return { ...result, _meta: { ...(result._meta || {}), ...meta } };
}
