// MCP plan catalog, purchase and account summary. The meter that spends these
// balances is api/_lib/mcp-credits.js.
//
// A plan is bought with the account's prepaid USD credits (api/_lib/credits.js),
// the same checkout every other metered action uses: top up at /credits with
// SOL, USDC or $THREE, then buy. The USD debit and the plan grant are idempotent
// on one key, so a retried purchase charges once and grants once: if the grant
// insert fails after the debit, retrying the same request finishes the grant
// without a second charge.

import { sql } from './db.js';
import { debitCredits, getCreditAccount } from './credits.js';
import { trialCallsPerTool, CREDIT_USD } from './mcp-credits.js';
import { TOOL_PRICING } from './pump-pricing.js';

function failure(status, code, message) {
	return Object.assign(new Error(message), { status, code });
}

function planRow(r) {
	return {
		slug: r.slug,
		name: r.name,
		description: r.description,
		kind: r.kind,
		credits: r.credits,
		durationSeconds: r.duration_seconds,
		priceUsd: Number(r.price_usd),
		tools: r.tools,
	};
}

export async function listPlans() {
	const rows = await sql`
		select slug, name, description, kind, credits, duration_seconds, price_usd, tools
		from mcp_plans where active order by sort_order, price_usd
	`;
	return rows.map(planRow);
}

/** Per-tool credit cost table the account page shows next to the plans. */
export function toolCreditTable() {
	return Object.entries(TOOL_PRICING).map(([tool, p]) => ({
		tool,
		credits: Math.max(1, Math.round(p.amount_usdc / CREDIT_USD)),
		amountUsdc: p.amount_usdc,
	}));
}

export async function purchasePlan({ userId, slug, idempotencyKey }) {
	if (!idempotencyKey) throw failure(400, 'validation_error', 'idempotency_key is required');
	const [plan] = await sql`
		select id, slug, name, kind, credits, duration_seconds, price_usd, tools
		from mcp_plans where slug = ${slug} and active
	`;
	if (!plan) throw failure(404, 'not_found', 'unknown plan');

	const purchaseKey = `mcp-plan:${userId}:${idempotencyKey}`;
	const [existing] = await sql`select id from mcp_plan_balances where purchase_key = ${purchaseKey}`;
	if (existing) return { balanceId: existing.id, replay: true };

	await debitCredits({
		userId,
		amountUsd: Number(plan.price_usd),
		action: 'mcp_plan',
		refType: 'mcp_plan',
		refId: plan.id,
		idempotencyKey: purchaseKey,
		meta: { slug: plan.slug },
	});

	const expiresAt =
		plan.kind === 'time' ? new Date(Date.now() + plan.duration_seconds * 1000).toISOString() : null;
	const [row] = await sql`
		insert into mcp_plan_balances
			(user_id, plan_id, kind, credits_total, credits_remaining, tools, expires_at, purchase_key)
		values (${userId}, ${plan.id}, ${plan.kind}, ${plan.credits}, ${plan.credits}, ${plan.tools}, ${expiresAt}, ${purchaseKey})
		on conflict (purchase_key) do update set purchase_key = excluded.purchase_key
		returning id
	`;
	return { balanceId: row.id, replay: false };
}

export async function accountSummary(userId, { historyLimit = 50 } = {}) {
	const limit = Math.min(Math.max(Number(historyLimit) || 50, 1), 200);
	const [balances, trials, history, usd] = await Promise.all([
		sql`
			select b.id, p.slug, p.name, b.kind, b.credits_total, b.credits_remaining, b.tools,
			       b.expires_at, b.created_at
			from mcp_plan_balances b join mcp_plans p on p.id = b.plan_id
			where b.user_id = ${userId}
			order by b.created_at desc
		`,
		sql`select tool, used from mcp_tool_trials where user_id = ${userId} order by tool`,
		sql`
			select id, tool, kind, credits, created_at from mcp_credit_events
			where user_id = ${userId} order by created_at desc, id desc limit ${limit}
		`,
		getCreditAccount(userId),
	]);
	const now = Date.now();
	const live = balances.filter((b) => !b.expires_at || new Date(b.expires_at).getTime() > now);
	const trialLimit = trialCallsPerTool();
	return {
		creditsRemaining: live.filter((b) => b.kind === 'credits').reduce((n, b) => n + b.credits_remaining, 0),
		timePasses: live
			.filter((b) => b.kind === 'time')
			.map((b) => ({ id: b.id, plan: b.name, expiresAt: b.expires_at, tools: b.tools })),
		bundles: balances
			.filter((b) => b.kind === 'credits')
			.map((b) => ({
				id: b.id,
				plan: b.name,
				total: b.credits_total,
				remaining: b.credits_remaining,
				purchasedAt: b.created_at,
			})),
		trials: { callsPerTool: trialLimit, used: trials.map((t) => ({ tool: t.tool, used: t.used, remaining: Math.max(0, trialLimit - t.used) })) },
		history: history.map((h) => ({ id: h.id, tool: h.tool, kind: h.kind, credits: h.credits, at: h.created_at })),
		usdBalance: usd.balanceUsd,
	};
}
