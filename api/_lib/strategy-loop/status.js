// Strategy loop read model: one shape for GET /api/v1/agents/:id/loop, the
// three://agents/{id}/loop MCP resource and the loop card on the agent page.
//
//   state       what the loop is doing right now (see loopState)
//   settings    the agent_loops row, or the preset defaults before first save
//   lease       which worker holds the agent, its last heartbeat and expiry
//   today       ticks, failures and loop spend since UTC midnight, against caps
//   lastTick / nextTickAt / errors / ticks (the recent timeline)
//
// listTicks() and getTick() page through the full history and one tick's steps.

import { sql } from '../db.js';
import { serializeLoop } from './settings.js';
import { loopSpendToday } from './budget.js';
import { toolTiers } from './tools.js';

export const TIMELINE_TICKS = 12;
export const MAX_TICKS_PAGE = 100;
const SUMMARY_PREVIEW_CHARS = 600;

/**
 * The loop's current state, derived from the agent, the loop row and the lease.
 *
 *   off          no loop, or the owner turned it off
 *   stopped      the loop is on but the agent is stopped: nothing ticks
 *   paused       a gate closed (cap, frozen wallet, credits, repeated errors)
 *   ticking      a worker holds the agent and a tick is open
 *   backing_off  the last ticks failed; the next one waits longer than usual
 *   scheduled    healthy, waiting for the next tick
 *
 * @param {{ agentStatus: string, loop: object, lease: object|null, openTick: boolean, now?: Date }} o
 */
export function loopState({ agentStatus, loop, lease, openTick, now = new Date() }) {
	if (!loop.configured || !loop.enabled) {
		return loop.paused?.reason === 'repeated_errors' ? 'paused' : 'off';
	}
	if (agentStatus && agentStatus !== 'running') return 'stopped';
	if (loop.paused) {
		const until = loop.paused.until ? new Date(loop.paused.until) : null;
		if (!until || until > now) return 'paused';
	}
	if (openTick && lease?.live) return 'ticking';
	if (loop.consecutiveErrors > 0) return 'backing_off';
	return 'scheduled';
}

function money(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

/** Timeline row for one tick (no steps). */
export function serializeTick(row) {
	const summary = row.summary || null;
	return {
		id: row.id,
		slot: row.slot,
		status: row.status,
		strategyId: row.strategy_id || null,
		steps: row.step_count,
		attempts: row.attempts,
		resumed: row.attempts > 1,
		spentCreditsUsd: money(row.spent_credits_usd),
		spentUsd: money(row.spent_usd),
		actions: row.actions,
		summary: summary && summary.length > SUMMARY_PREVIEW_CHARS ? `${summary.slice(0, SUMMARY_PREVIEW_CHARS)}...` : summary,
		error: row.error || null,
		workerId: row.worker_id || null,
		startedAt: row.started_at,
		finishedAt: row.finished_at || null,
		durationMs: row.finished_at ? new Date(row.finished_at) - new Date(row.started_at) : null,
	};
}

function serializeLease(row, now = new Date()) {
	if (!row) return null;
	return {
		workerId: row.worker_id,
		heartbeatAt: row.heartbeat_at,
		leaseUntil: row.lease_until,
		live: new Date(row.lease_until) > now,
		tickId: row.tick_id || null,
		claims: row.claims,
		reclaims: row.reclaims,
	};
}

const TICK_COLUMNS = sql`
	id, slot, status, strategy_id, step_count, attempts, spent_credits_usd, spent_usd, actions,
	summary, error, worker_id, started_at, finished_at
`;

/**
 * Everything the owner needs to see about an agent's loop.
 * @param {{ id: string, user_id: string, status?: string, meta?: object, name?: string }} agent
 */
export async function loopStatus(agent) {
	const [[row], [leaseRow], today, ticks] = await Promise.all([
		sql`SELECT * FROM agent_loops WHERE agent_id = ${agent.id}`,
		sql`SELECT * FROM agent_leases WHERE agent_id = ${agent.id}`,
		loopSpendToday(agent.id),
		sql`
			SELECT ${TICK_COLUMNS} FROM agent_loop_ticks
			 WHERE agent_id = ${agent.id}
			 ORDER BY started_at DESC
			 LIMIT ${TIMELINE_TICKS}
		`,
	]);
	const loop = serializeLoop(row || null, agent);
	const now = new Date();
	const lease = serializeLease(leaseRow, now);
	const timeline = ticks.map(serializeTick);
	const open = timeline.find((t) => t.status === 'running') || null;
	const last = timeline.find((t) => t.status !== 'running') || null;
	const recentErrors = timeline.filter((t) => t.status === 'failed').slice(0, 5).map((t) => ({ tickId: t.id, at: t.startedAt, error: t.error }));
	const agentStatus = agent.status || 'running';

	return {
		agentId: agent.id,
		agentStatus,
		state: loopState({ agentStatus, loop, lease, openTick: Boolean(open), now }),
		settings: {
			configured: loop.configured,
			enabled: loop.enabled,
			strategyId: loop.strategyId,
			goal: loop.goal,
			intervalSeconds: loop.intervalSeconds,
			maxSteps: loop.maxSteps,
			tools: loop.tools,
			financialEnabled: loop.financialEnabled,
			caps: loop.caps,
		},
		toolTiers: toolTiers(loop),
		paused: loop.paused,
		lease,
		openTick: open,
		lastTick: last,
		lastTickAt: loop.lastTickAt,
		lastTickStatus: loop.lastTickStatus,
		nextTickAt: loop.enabled && agentStatus === 'running' ? loop.nextTickAt : null,
		today: {
			ticks: today.ticks,
			failed: today.failed,
			spentCreditsUsd: money(today.creditsUsd),
			spentUsd: money(today.usdcUsd),
			remainingCreditsUsd: money(Math.max(0, loop.caps.dailyCreditsUsd - today.creditsUsd)),
			remainingUsd: money(Math.max(0, loop.caps.dailyUsdcUsd - today.usdcUsd)),
		},
		errors: { consecutive: loop.consecutiveErrors, recent: recentErrors },
		ticks: timeline,
		generatedAt: now.toISOString(),
	};
}

/**
 * A page of an agent's ticks, newest first. `before` is the startedAt of the
 * last tick on the previous page.
 */
export async function listTicks(agentId, { limit = 25, before = null } = {}) {
	const n = Math.max(1, Math.min(MAX_TICKS_PAGE, limit));
	const rows = before
		? await sql`
			SELECT ${TICK_COLUMNS} FROM agent_loop_ticks
			 WHERE agent_id = ${agentId} AND started_at < ${before}
			 ORDER BY started_at DESC LIMIT ${n + 1}`
		: await sql`
			SELECT ${TICK_COLUMNS} FROM agent_loop_ticks
			 WHERE agent_id = ${agentId}
			 ORDER BY started_at DESC LIMIT ${n + 1}`;
	const items = rows.slice(0, n).map(serializeTick);
	const hasMore = rows.length > n;
	return { items, hasMore, nextCursor: hasMore ? new Date(items[items.length - 1].startedAt).toISOString() : null };
}

/** One tick with every step, or null when it is not this agent's. */
export async function getTick(agentId, tickId) {
	const [row] = await sql`
		SELECT ${TICK_COLUMNS}, goal, previews FROM agent_loop_ticks WHERE id = ${tickId} AND agent_id = ${agentId}
	`;
	if (!row) return null;
	const steps = await sql`
		SELECT seq, kind, provider, model, tool_name, input, output, input_tokens, output_tokens, cost_usd, latency_ms, created_at
		  FROM agent_loop_tick_steps WHERE tick_id = ${row.id} ORDER BY seq ASC LIMIT 400
	`;
	return {
		...serializeTick(row),
		summary: row.summary || null,
		goal: row.goal,
		previews: Object.entries(row.previews || {}).map(([id, p]) => ({ id, ...p })),
		steps: steps.map((s) => ({
			seq: s.seq,
			kind: s.kind,
			provider: s.provider || null,
			model: s.model || null,
			tool: s.tool_name || null,
			input: s.input ?? null,
			output: s.output ?? null,
			inputTokens: s.input_tokens ?? null,
			outputTokens: s.output_tokens ?? null,
			costUsd: s.cost_usd == null ? null : money(s.cost_usd),
			latencyMs: s.latency_ms ?? null,
			at: s.created_at,
		})),
	};
}
