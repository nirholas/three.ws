// /api/me/spend: the owner's spend page data (pages/spend.html).
//
//   GET /api/me/spend?days=30&agent=<id>
//
// One read model for everything the spend page shows:
//   - balance and month-to-date spend across every agent,
//   - per agent: name, status, dollar caps (daily/monthly) with use, percent
//     and the 50/80 alerts already sent, token caps from
//     api/_lib/token-budgets.js (hourly/daily/per-run with use, extension and
//     pause), and the pause the agent is in if any,
//   - usage by day (usd, calls, tokens) for the chosen range,
//   - usage by model and by tool over the same range,
//   - the month-end projection: month-to-date scaled by days elapsed, and the
//     same from the trailing seven days (which is the one that moves first when
//     an agent starts or stops),
//   - every alert at 50, 80 and 100 percent of any cap, derived from the same
//     latches the notifications use, so the page and the bell always agree.
//
// Spend rows come from credit_ledger (ref_type 'agent', the model-spend
// actions in AGENT_SPEND_ACTIONS). Tool calls come from usage_events. Session
// callers are the owner; bearer callers need inference, wallet:read,
// wallet:write or profile.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, error, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getCreditAccount } from '../_lib/credits.js';
import {
	AGENT_SPEND_ACTIONS,
	getInferenceBudget,
	agentInferenceSpend,
	windowKeys,
} from '../_lib/inference-billing.js';
import { tokenBudgetStatus, alertsFor, nextTokenReset } from '../_lib/token-budgets.js';
import { isUuid } from '../_lib/validate.js';

const MIN_DAYS = 1;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

async function resolveCaller(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, scope: null };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, scope: bearer.scope || '' };
	return null;
}

function scopeOk(caller, ...scopes) {
	if (caller.scope === null) return true;
	return scopes.some((s) => hasScope(caller.scope, s));
}

function round6(n) {
	return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

function pctOf(used, limit) {
	if (!(limit > 0)) return null;
	return Math.min(999, Math.round((used / limit) * 1000) / 10);
}

function readDays(query) {
	const n = Number.parseInt(String(query?.days ?? DEFAULT_DAYS), 10);
	if (!Number.isFinite(n)) return DEFAULT_DAYS;
	return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

/** UTC start and end of the current month, and how far through it we are. */
export function monthProgress(now = new Date()) {
	const y = now.getUTCFullYear();
	const m = now.getUTCMonth();
	const start = new Date(Date.UTC(y, m, 1));
	const end = new Date(Date.UTC(y, m + 1, 1));
	const daysInMonth = Math.round((end - start) / 86_400_000);
	const elapsed = (now - start) / 86_400_000;
	return { start, end, daysInMonth, elapsedDays: Math.max(elapsed, 1 / 24), remainingDays: Math.max(0, daysInMonth - elapsed) };
}

/** Month-end projections from month-to-date pace and from the trailing week. */
export function projectMonth({ mtdUsd, weekUsd, balanceUsd = 0, now = new Date() }) {
	const progress = monthProgress(now);
	return {
		days_elapsed: Math.round(progress.elapsedDays * 100) / 100,
		days_in_month: progress.daysInMonth,
		projected_usd: round6((mtdUsd / progress.elapsedDays) * progress.daysInMonth),
		projected_from_week_usd: round6(mtdUsd + (weekUsd / 7) * progress.remainingDays),
		balance_lasts_days: weekUsd > 0 ? Math.round((balanceUsd / (weekUsd / 7)) * 10) / 10 : null,
		resets_at: progress.end.toISOString(),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const caller = await resolveCaller(req);
	if (!caller) return error(res, 401, 'unauthorized', 'sign in, or send a three.ws API key as a Bearer token (npx three-ws login)');
	if (!scopeOk(caller, 'inference', 'wallet:read', 'wallet:write', 'profile')) {
		return error(res, 403, 'insufficient_scope', 'reading spend needs the inference, wallet:read or profile scope');
	}
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const agentFilter = req.query?.agent ? String(req.query.agent) : null;
	if (agentFilter && !isUuid(agentFilter)) return error(res, 400, 'bad_request', 'agent must be an agent id');
	const days = readDays(req.query);

	let data;
	try {
		data = await spendReadModel({ userId: caller.userId, agentId: agentFilter, days });
	} catch (err) {
		if (err?.expose && err.status) return error(res, err.status, err.code, err.message);
		throw err;
	}
	return json(res, data);
});

/** The whole read model, exported so the test can call it without HTTP. */
export async function spendReadModel({ userId, agentId = null, days = DEFAULT_DAYS, now = new Date() }) {
	const agents = await sql`
		SELECT id, name, status, meta, created_at
		FROM agent_identities
		WHERE user_id = ${userId} AND deleted_at IS NULL
		  AND (${agentId}::uuid IS NULL OR id = ${agentId})
		ORDER BY created_at ASC
	`;
	if (agentId && !agents.length) {
		const err = new Error('agent not found');
		err.status = 404;
		err.code = 'not_found';
		err.expose = true;
		throw err;
	}
	const ids = agents.map((a) => String(a.id));
	const sinceDays = `${days} days`;

	const [account, byDay, byModel, byTool, month, week, perAgentRows] = await Promise.all([
		getCreditAccount(userId),
		sql`
			SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
			       ref_id AS agent_id,
			       COALESCE(SUM(-amount_usd), 0)::float8 AS usd,
			       COUNT(*)::int AS calls,
			       COALESCE(SUM(COALESCE((meta->>'input_tokens')::bigint, 0) + COALESCE((meta->>'output_tokens')::bigint, 0)), 0)::bigint AS tokens
			FROM credit_ledger
			WHERE user_id = ${userId} AND action = ANY(${AGENT_SPEND_ACTIONS})
			  AND ref_type = 'agent' AND ref_id = ANY(${ids})
			  AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ${sinceDays}::interval + interval '1 day'
			GROUP BY 1, 2
			ORDER BY 1 ASC
		`,
		sql`
			SELECT COALESCE(meta->>'lane_model', meta->>'model', 'unknown') AS model,
			       COALESCE(meta->>'lane', meta->>'provider', '') AS provider,
			       COALESCE(SUM(-amount_usd), 0)::float8 AS usd,
			       COUNT(*)::int AS calls,
			       COALESCE(SUM(COALESCE((meta->>'input_tokens')::bigint, 0)), 0)::bigint AS input_tokens,
			       COALESCE(SUM(COALESCE((meta->>'output_tokens')::bigint, 0)), 0)::bigint AS output_tokens
			FROM credit_ledger
			WHERE user_id = ${userId} AND action = ANY(${AGENT_SPEND_ACTIONS})
			  AND ref_type = 'agent' AND ref_id = ANY(${ids})
			  AND created_at >= now() - ${sinceDays}::interval
			GROUP BY 1, 2
			ORDER BY usd DESC, calls DESC
			LIMIT 50
		`,
		sql`
			SELECT COALESCE(NULLIF(tool, ''), kind) AS tool,
			       kind,
			       COUNT(*)::int AS calls,
			       COUNT(*) FILTER (WHERE status IS NULL OR status < 400)::int AS ok,
			       COALESCE(SUM(cost_micro_usd), 0)::bigint AS cost_micro_usd,
			       COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS tokens,
			       MAX(created_at) AS last_at
			FROM usage_events
			WHERE user_id = ${userId} AND agent_id = ANY(${ids}::uuid[])
			  AND created_at >= now() - ${sinceDays}::interval
			GROUP BY 1, 2
			ORDER BY calls DESC
			LIMIT 50
		`,
		sql`
			SELECT COALESCE(SUM(-amount_usd), 0)::float8 AS usd, COUNT(*)::int AS calls
			FROM credit_ledger
			WHERE user_id = ${userId} AND action = ANY(${AGENT_SPEND_ACTIONS})
			  AND ref_type = 'agent' AND ref_id = ANY(${ids})
			  AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
		`,
		sql`
			SELECT COALESCE(SUM(-amount_usd), 0)::float8 AS usd, COUNT(*)::int AS calls
			FROM credit_ledger
			WHERE user_id = ${userId} AND action = ANY(${AGENT_SPEND_ACTIONS})
			  AND ref_type = 'agent' AND ref_id = ANY(${ids})
			  AND created_at >= now() - interval '7 days'
		`,
		Promise.all(agents.map((agent) => agentSpendCard(agent, now))),
	]);

	const mtd = round6(month[0]?.usd);
	const weekUsd = round6(week[0]?.usd);
	const alerts = perAgentRows.flatMap((card) => card.alerts);
	alerts.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

	return {
		generated_at: now.toISOString(),
		range_days: days,
		balance_usd: round6(account.balanceUsd),
		lifetime_spent_usd: round6(account.lifetimeSpentUsd),
		month: {
			key: windowKeys(now).month,
			to_date_usd: mtd,
			calls: Number(month[0]?.calls || 0),
			last_7_days_usd: weekUsd,
			...projectMonth({ mtdUsd: mtd, weekUsd, balanceUsd: account.balanceUsd, now }),
		},
		agents: perAgentRows.map((card) => card.agent),
		by_day: byDay.map((r) => ({
			day: r.day,
			agent_id: r.agent_id,
			usd: round6(r.usd),
			calls: Number(r.calls || 0),
			tokens: Number(r.tokens || 0),
		})),
		by_model: byModel.map((r) => ({
			model: r.model,
			provider: r.provider || null,
			usd: round6(r.usd),
			calls: Number(r.calls || 0),
			input_tokens: Number(r.input_tokens || 0),
			output_tokens: Number(r.output_tokens || 0),
		})),
		by_tool: byTool.map((r) => ({
			tool: r.tool,
			kind: r.kind,
			calls: Number(r.calls || 0),
			ok: Number(r.ok || 0),
			usd: round6(Number(r.cost_micro_usd || 0) / 1e6),
			tokens: Number(r.tokens || 0),
			last_at: r.last_at,
		})),
		alerts,
	};
}

/** One agent's caps, use, pause and the alerts derived from its latches. */
async function agentSpendCard(agent, now) {
	const budget = getInferenceBudget(agent.meta);
	const keys = windowKeys(now);
	const [spend, tokens] = await Promise.all([
		agentInferenceSpend(agent.id),
		tokenBudgetStatus({ agent }),
	]);
	const dayReset = nextTokenReset('day', now);
	const monthReset = monthProgress(now).end.toISOString();
	const usdWindows = [];
	if (budget?.daily_usd) {
		usdWindows.push(usdWindow({ agent, window: 'day', key: keys.day, limit: budget.daily_usd, used: spend.today_usd, resetsAt: dayReset }));
	}
	if (budget?.monthly_usd) {
		usdWindows.push(usdWindow({ agent, window: 'month', key: keys.month, limit: budget.monthly_usd, used: spend.month_usd, resetsAt: monthReset }));
	}
	const alerts = [];
	for (const w of usdWindows) {
		for (const threshold of alertMarks(w)) {
			alerts.push(alertRow({ agent, cap: 'usd', window: w.window, threshold, pct: w.pct, limit: w.limit_usd, used: w.used_usd, unit: 'usd', resetsAt: w.resets_at }));
		}
	}
	for (const w of tokens?.windows || []) {
		for (const threshold of alertMarks(w)) {
			alerts.push(alertRow({ agent, cap: 'tokens', window: w.window, threshold, pct: w.pct, limit: w.ceiling_tokens, used: w.used_tokens, unit: 'tokens', resetsAt: w.resets_at }));
		}
	}
	const exhaustion = agent.meta?.inference_budget?.exhausted || null;
	let pause = null;
	if (tokens?.paused) pause = { kind: 'tokens', ...tokens.paused };
	else if (exhaustion && agent.status === 'stopped') {
		pause = { kind: 'usd', window: exhaustion.window, at: exhaustion.at, resets_at: exhaustion.window === 'day' ? dayReset : monthReset };
	}
	return {
		agent: {
			id: agent.id,
			name: agent.name,
			status: agent.status,
			usd: {
				daily_usd: budget?.daily_usd ?? null,
				monthly_usd: budget?.monthly_usd ?? null,
				today_usd: spend.today_usd,
				month_usd: spend.month_usd,
				calls_today: spend.calls_today,
				windows: usdWindows,
			},
			tokens,
			pause,
		},
		alerts,
	};
}

function usdWindow({ agent, window, key, limit, used, resetsAt }) {
	return {
		window,
		key,
		limit_usd: limit,
		used_usd: used,
		pct: pctOf(used, limit),
		exhausted: used >= limit,
		resets_at: resetsAt,
		alerts: alertsFor(agent.meta, `usd:${window}`, key),
	};
}

/** The 50/80 marks already latched plus 100 when the window is full. */
export function alertMarks(w) {
	const marks = new Set((w.alerts || []).filter((n) => n === 50 || n === 80));
	if (w.exhausted) marks.add(100);
	return [...marks].sort((a, b) => a - b);
}

function alertRow({ agent, cap, window, threshold, pct, limit, used, unit, resetsAt }) {
	return { agent_id: agent.id, agent_name: agent.name, cap, window, threshold, pct, limit, used, unit, resets_at: resetsAt };
}
