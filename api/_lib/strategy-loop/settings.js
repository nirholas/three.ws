// Strategy loop settings: the per-agent agent_loops row, its defaults from the
// strategy preset, and owner edits.
//
// Every setting has a preset default (data/agent-strategies.json `loop` block
// plus the preset's toolsAllowed), so enabling the loop on an agent created
// from a preset needs no configuration at all. An owner may override the goal,
// the interval, the read tools, the caps and whether the financial tier is on.
// The financial tier is off until the owner turns it on explicitly with
// `confirm_financial: true` AND has signed the real-funds agreements.

import { sql } from '../db.js';
import { AGENT_TOOLS } from '../agent-tools.js';
import { getStrategy } from '../agents-v1/strategies.js';

export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 86_400;
export const DEFAULT_INTERVAL_SECONDS = 300;
export const DEFAULT_MAX_STEPS = 12;
export const DEFAULT_CREDIT_CAP_USD = 0.5;
export const MAX_CAP_USD = 10_000;
export const MAX_GOAL_CHARS = 2000;

// When a loop runs without a preset: read tools that change nothing and
// answer the questions a strategy asks every tick.
export const DEFAULT_READ_TOOLS = Object.freeze(['token_price', 'trending_tokens', 'token_safety', 'sol_balance', 'web_search']);

export const DEFAULT_GOAL =
	'Check the markets and the agent wallet, compare with what you remembered from earlier ticks, report only what changed, and remember anything worth tracking next time.';

/** The v1 error shape, without importing the HTTP layer into the worker. */
export class LoopSettingsError extends Error {
	constructor(status, code, message, details = null) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

const bad = (code, message, parameter) => new LoopSettingsError(400, code, message, parameter ? { parameter } : null);

/** The strategy preset an agent was created with, or null. */
export function presetFor(agent) {
	const id = agent?.meta?.runtime?.strategy || null;
	return id ? getStrategy(id) || null : null;
}

/** The settings a brand-new loop starts from for this agent. */
export function loopDefaults(agent) {
	const preset = presetFor(agent);
	return {
		strategyId: preset?.id || null,
		goal: preset?.loop?.goal || DEFAULT_GOAL,
		intervalSeconds: preset?.loop?.intervalMinutes ? preset.loop.intervalMinutes * 60 : DEFAULT_INTERVAL_SECONDS,
		tools: [...(preset?.toolsAllowed || DEFAULT_READ_TOOLS)],
		dailyCreditCapUsd: preset?.loop?.dailyCreditCapUsd ?? DEFAULT_CREDIT_CAP_USD,
		dailyUsdcCapUsd: 0,
		financialEnabled: false,
		maxSteps: DEFAULT_MAX_STEPS,
	};
}

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/** Shape an agent_loops row (or the defaults when there is none) for callers. */
export function serializeLoop(row, agent) {
	if (!row) {
		const d = loopDefaults(agent);
		return {
			configured: false,
			enabled: false,
			strategyId: d.strategyId,
			goal: d.goal,
			intervalSeconds: d.intervalSeconds,
			tools: d.tools,
			financialEnabled: false,
			maxSteps: d.maxSteps,
			caps: { dailyCreditsUsd: d.dailyCreditCapUsd, dailyUsdcUsd: 0 },
			paused: null,
			nextTickAt: null,
			lastTickAt: null,
			lastTickStatus: null,
			consecutiveErrors: 0,
		};
	}
	return {
		configured: true,
		enabled: row.enabled,
		strategyId: row.strategy_id,
		goal: row.goal || DEFAULT_GOAL,
		intervalSeconds: row.interval_seconds,
		tools: row.tools || [],
		financialEnabled: row.financial_enabled,
		maxSteps: row.max_steps,
		caps: { dailyCreditsUsd: num(row.daily_credit_cap_usd), dailyUsdcUsd: num(row.daily_usdc_cap_usd) },
		paused: row.paused_reason
			? { reason: row.paused_reason, detail: row.paused_detail || null, at: row.paused_at, until: row.paused_until }
			: null,
		nextTickAt: row.next_tick_at,
		lastTickAt: row.last_tick_at,
		lastTickStatus: row.last_tick_status,
		consecutiveErrors: row.consecutive_errors,
	};
}

export async function getLoopRow(agentId) {
	const [row] = await sql`SELECT * FROM agent_loops WHERE agent_id = ${agentId}`;
	return row || null;
}

function capParam(v, name) {
	const n = Number(v);
	if (!Number.isFinite(n) || n < 0 || n > MAX_CAP_USD) throw bad('invalid_parameter', `${name} must be a number from 0 to ${MAX_CAP_USD}.`, name);
	return Math.round(n * 1e6) / 1e6;
}

/**
 * Validate a PATCH body into a partial settings object. Unknown keys are
 * ignored; a present key with a bad value is a 400 naming the parameter.
 */
export function parseLoopPatch(body) {
	const b = body && typeof body === 'object' ? body : {};
	const out = {};
	if ('enabled' in b) {
		if (typeof b.enabled !== 'boolean') throw bad('invalid_parameter', 'enabled must be true or false.', 'enabled');
		out.enabled = b.enabled;
	}
	if ('goal' in b) {
		if (b.goal === null || b.goal === '') out.goal = null;
		else if (typeof b.goal !== 'string' || b.goal.trim().length > MAX_GOAL_CHARS) {
			throw bad('invalid_parameter', `goal must be text of at most ${MAX_GOAL_CHARS} characters.`, 'goal');
		} else out.goal = b.goal.trim();
	}
	if ('intervalSeconds' in b || 'intervalMinutes' in b) {
		const secs = 'intervalSeconds' in b ? Number(b.intervalSeconds) : Number(b.intervalMinutes) * 60;
		if (!Number.isInteger(secs) || secs < MIN_INTERVAL_SECONDS || secs > MAX_INTERVAL_SECONDS) {
			throw bad('invalid_parameter', `The interval must be a whole number of seconds from ${MIN_INTERVAL_SECONDS} to ${MAX_INTERVAL_SECONDS}.`, 'intervalSeconds');
		}
		out.intervalSeconds = secs;
	}
	if ('tools' in b) {
		if (!Array.isArray(b.tools) || b.tools.length > 20) throw bad('invalid_parameter', 'tools must be an array of tool names.', 'tools');
		const unknown = b.tools.filter((t) => typeof t !== 'string' || !AGENT_TOOLS[t]);
		if (unknown.length) {
			throw new LoopSettingsError(400, 'unknown_tool', `Unknown read tool: ${unknown.join(', ')}.`, {
				parameter: 'tools',
				available: Object.keys(AGENT_TOOLS),
			});
		}
		out.tools = [...new Set(b.tools)];
	}
	if ('maxSteps' in b) {
		const n = Number(b.maxSteps);
		if (!Number.isInteger(n) || n < 3 || n > 40) throw bad('invalid_parameter', 'maxSteps must be an integer from 3 to 40.', 'maxSteps');
		out.maxSteps = n;
	}
	const caps = b.caps && typeof b.caps === 'object' ? b.caps : {};
	if ('dailyCreditsUsd' in caps) out.dailyCreditCapUsd = capParam(caps.dailyCreditsUsd, 'caps.dailyCreditsUsd');
	if ('dailyUsdcUsd' in caps) out.dailyUsdcCapUsd = capParam(caps.dailyUsdcUsd, 'caps.dailyUsdcUsd');
	if ('financialEnabled' in b) {
		if (typeof b.financialEnabled !== 'boolean') throw bad('invalid_parameter', 'financialEnabled must be true or false.', 'financialEnabled');
		if (b.financialEnabled && b.confirm_financial !== true) {
			throw new LoopSettingsError(
				400,
				'confirmation_required',
				'Turning on the financial tier lets loop ticks trade from the agent wallet within your caps and guards. Resend with "confirm_financial": true to confirm.',
				{ parameter: 'confirm_financial' },
			);
		}
		out.financialEnabled = b.financialEnabled;
	}
	return out;
}

/** The first UTC midnight after `now`. */
export function nextUtcMidnight(now = new Date()) {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Apply a parsed patch, creating the row from the preset defaults on first
 * write. Turning the loop on schedules the first tick immediately; raising a
 * cap that paused the loop lifts the pause. Returns the new row.
 */
export async function saveLoopSettings(agent, patch) {
	const d = loopDefaults(agent);
	const existing = await getLoopRow(agent.id);
	const cur = existing
		? {
				enabled: existing.enabled,
				goal: existing.goal,
				intervalSeconds: existing.interval_seconds,
				tools: existing.tools,
				financialEnabled: existing.financial_enabled,
				maxSteps: existing.max_steps,
				dailyCreditCapUsd: num(existing.daily_credit_cap_usd),
				dailyUsdcCapUsd: num(existing.daily_usdc_cap_usd),
			}
		: { ...d, enabled: false };
	const next = { ...cur, ...patch };

	const turningOn = next.enabled && !cur.enabled;
	const capRaised =
		(patch.dailyCreditCapUsd != null && patch.dailyCreditCapUsd > cur.dailyCreditCapUsd) ||
		(patch.dailyUsdcCapUsd != null && patch.dailyUsdcCapUsd > cur.dailyUsdcCapUsd);
	const clearCapPause = capRaised || turningOn;

	const [row] = await sql`
		INSERT INTO agent_loops (
			agent_id, user_id, enabled, strategy_id, goal, interval_seconds, tools,
			financial_enabled, max_steps, daily_credit_cap_usd, daily_usdc_cap_usd, next_tick_at
		) VALUES (
			${agent.id}, ${agent.user_id}, ${next.enabled}, ${d.strategyId}, ${next.goal}, ${next.intervalSeconds}, ${next.tools},
			${next.financialEnabled}, ${next.maxSteps}, ${String(next.dailyCreditCapUsd)}, ${String(next.dailyUsdcCapUsd)},
			${next.enabled ? new Date().toISOString() : null}
		)
		ON CONFLICT (agent_id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			goal = EXCLUDED.goal,
			interval_seconds = EXCLUDED.interval_seconds,
			tools = EXCLUDED.tools,
			financial_enabled = EXCLUDED.financial_enabled,
			max_steps = EXCLUDED.max_steps,
			daily_credit_cap_usd = EXCLUDED.daily_credit_cap_usd,
			daily_usdc_cap_usd = EXCLUDED.daily_usdc_cap_usd,
			next_tick_at = CASE
				WHEN ${turningOn} THEN now()
				WHEN EXCLUDED.enabled AND agent_loops.next_tick_at IS NULL THEN now()
				ELSE agent_loops.next_tick_at END,
			consecutive_errors = CASE WHEN ${turningOn} THEN 0 ELSE agent_loops.consecutive_errors END,
			errors_alerted_at = CASE WHEN ${turningOn} THEN NULL ELSE agent_loops.errors_alerted_at END,
			paused_reason = CASE WHEN ${clearCapPause} AND agent_loops.paused_reason IN ('credit_cap', 'usdc_cap', 'repeated_errors')
				THEN NULL ELSE agent_loops.paused_reason END,
			paused_detail = CASE WHEN ${clearCapPause} AND agent_loops.paused_reason IN ('credit_cap', 'usdc_cap', 'repeated_errors')
				THEN NULL ELSE agent_loops.paused_detail END,
			paused_until = CASE WHEN ${clearCapPause} AND agent_loops.paused_reason IN ('credit_cap', 'usdc_cap', 'repeated_errors')
				THEN NULL ELSE agent_loops.paused_until END,
			updated_at = now()
		RETURNING *
	`;
	return row;
}
