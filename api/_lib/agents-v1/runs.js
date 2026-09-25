// Agent runs: a goal an agent pursues through the server-side tool loop, one
// checkpointed step at a time (tables agent_runs / agent_run_steps, migration
// 20260922130000_agents_v1_api.sql).
//
// A run never lives in one process. Every step:
//   1. takes a short lease on the row (lease_owner / lease_until) so the SSE
//      stream, a polling page and the run cron can never step it twice at once,
//   2. rebuilds the loop from api/_lib/agent-loop.js and advances it one step
//      from the persisted `checkpoint` ({ state, context }),
//   3. writes every model call, tool call and tool result as a step row with
//      its tokens, cost and latency,
//   4. charges paid model spend to the owner's credits (free lanes cost
//      nothing) and stops the run at its credit budget,
//   5. saves the new checkpoint and releases the lease.
//
// A run with a zero credit budget is restricted to the free model lanes, so it
// can never spend a cent. Cancellation is honored before the next step, which
// bounds "cancel stops the loop" to one step. The tool registry is read-only
// (api/_lib/agent-tools.js): nothing a run does can sign or move funds.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { apiError } from './http.js';
import { providerChainFor } from '../llm-tool-chain.js';
import { isFreeLane } from '../llm-pricing.js';
import { agentToolSchemas, agentToolHandlers } from '../agent-tools.js';
import { debitCredits } from '../credits.js';
import { assertAgentBudget, InferenceBillingError } from '../inference-billing.js';
import { AGENT_SYSTEM_NOTE, createAgentLoop, finalAnswer, initialLoopState, loopFinished } from '../agent-loop.js';

const LEASE_SECONDS = 120;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'budget_exhausted']);
// Runtime steps per requested step: one model call plus its tool batch and the
// result hand-back. A ceiling on top of the runtime's own maxSteps accounting.
const RUNTIME_STEPS_PER_STEP = 4;
const MAX_GOAL_CHARS = 8000;

export { TERMINAL as TERMINAL_RUN_STATUSES };

function toNumber(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/** Public projection of a run row. */
export function serializeRun(r) {
	if (!r) return null;
	return {
		id: r.id,
		agentId: r.agent_id,
		goal: r.goal,
		status: r.status,
		model: r.model,
		temperature: r.temperature == null ? null : Number(r.temperature),
		toolsAllowed: r.tools_allowed,
		maxSteps: r.max_steps,
		stepCount: r.step_count,
		budget: { creditsUsd: toNumber(r.budget_credits_usd), usd: toNumber(r.budget_usd) },
		spent: { creditsUsd: toNumber(r.spent_credits_usd), usd: toNumber(r.spent_usd) },
		scheduleCron: r.schedule_cron,
		scheduledFor: r.scheduled_for,
		result: r.result,
		error: r.error,
		source: r.source,
		automationId: r.automation_id,
		cancelRequested: Boolean(r.cancel_requested_at),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		startedAt: r.started_at,
		finishedAt: r.finished_at,
	};
}

export function serializeStep(s) {
	return {
		seq: s.seq,
		kind: s.kind,
		provider: s.provider,
		model: s.model,
		tool: s.tool_name,
		input: s.input,
		output: s.output,
		usage: s.input_tokens == null && s.output_tokens == null ? null : { input: s.input_tokens, output: s.output_tokens },
		costUsd: s.cost_micro_usd == null ? null : Number(s.cost_micro_usd) / 1e6,
		latencyMs: s.latency_ms,
		at: s.created_at,
	};
}

/**
 * Create a run. Returns the run row, or null when an automation already
 * started a run for this exact trigger (the fire is idempotent).
 *
 * @param {object} o
 * @param {string} o.agentId
 * @param {string} o.userId
 * @param {string} o.goal
 * @param {string|null} [o.model]
 * @param {number|null} [o.temperature]
 * @param {string[]|null} [o.toolsAllowed]  subset of the read-only registry; null means all
 * @param {number} [o.maxSteps]
 * @param {number} [o.budgetCreditsUsd]    0 restricts the run to free model lanes
 * @param {number} [o.budgetUsd]
 * @param {string|null} [o.scheduledFor]   ISO time to start; null starts now
 * @param {string} [o.source]
 * @param {string|null} [o.automationId]
 * @param {string|null} [o.triggerKey]
 */
export async function createRun({
	agentId,
	userId,
	goal,
	model = null,
	temperature = null,
	toolsAllowed = null,
	maxSteps = 12,
	budgetCreditsUsd = 0,
	budgetUsd = 0,
	scheduleCron = null,
	scheduledFor = null,
	source = 'api',
	automationId = null,
	triggerKey = null,
}) {
	const text = String(goal || '').trim();
	if (!text) throw apiError(400, 'goal_required', 'A run needs a goal.');
	if (text.length > MAX_GOAL_CHARS) throw apiError(400, 'goal_too_long', `The goal must be at most ${MAX_GOAL_CHARS} characters.`);
	const steps = Math.min(60, Math.max(1, Math.floor(Number(maxSteps) || 12)));
	const credits = Math.max(0, Number(budgetCreditsUsd) || 0);
	const usd = Math.max(0, Number(budgetUsd) || 0);

	if (toolsAllowed != null) {
		const known = new Set(agentToolSchemas().map((t) => t.function.name));
		const unknown = toolsAllowed.filter((t) => !known.has(t));
		if (unknown.length) throw apiError(400, 'unknown_tool', `Unknown tool(s): ${unknown.join(', ')}.`, { known: [...known] });
	}

	const [agent] = await sql`
		SELECT id, user_id, status, deleted_at FROM agent_identities WHERE id = ${agentId} LIMIT 1
	`;
	if (!agent || agent.deleted_at) throw apiError(404, 'agent_not_found', 'Agent not found.');
	if (agent.user_id !== userId) throw apiError(403, 'forbidden', "That agent isn't on your account.");
	if (agent.status === 'stopped') {
		throw apiError(409, 'agent_stopped', 'This agent is stopped. Start it before creating a run.');
	}

	const status = scheduledFor && new Date(scheduledFor) > new Date() ? 'scheduled' : 'queued';
	const [row] = await sql`
		INSERT INTO agent_runs
			(agent_id, user_id, goal, status, model, temperature, tools_allowed, max_steps,
			 budget_credits_usd, budget_usd, schedule_cron, scheduled_for, source, automation_id, trigger_key)
		VALUES
			(${agentId}, ${userId}, ${text}, ${status}, ${model}, ${temperature}, ${toolsAllowed}, ${steps},
			 ${credits}, ${usd}, ${scheduleCron}, ${scheduledFor}, ${source}, ${automationId}, ${triggerKey})
		ON CONFLICT DO NOTHING
		RETURNING *
	`;
	if (!row) return null;
	await insertSteps(row.id, 0, [{ kind: 'status', output: { status, note: 'run created' } }]);
	return row;
}

/** Load a run the caller owns, or throw 404. */
export async function getOwnedRun(runId, userId) {
	const [row] = await sql`SELECT * FROM agent_runs WHERE id = ${runId} AND user_id = ${userId} LIMIT 1`;
	if (!row) throw apiError(404, 'run_not_found', 'Run not found.');
	return row;
}

/** Steps of a run the caller owns, after sequence number `after`. */
export async function listRunSteps(runId, userId, { after = 0, limit = 200 } = {}) {
	await getOwnedRun(runId, userId);
	const rows = await sql`
		SELECT * FROM agent_run_steps
		WHERE run_id = ${runId} AND seq > ${Math.max(0, Number(after) || 0)}
		ORDER BY seq ASC
		LIMIT ${Math.min(500, Math.max(1, Number(limit) || 200))}
	`;
	return rows.map(serializeStep);
}

/** Request cancellation. The loop stops before its next step. */
export async function cancelRun(runId, userId) {
	const run = await getOwnedRun(runId, userId);
	if (TERMINAL.has(run.status)) return run;
	const [row] = await sql`
		UPDATE agent_runs SET cancel_requested_at = now(), updated_at = now()
		WHERE id = ${runId} RETURNING *
	`;
	// A run nobody is stepping right now is finalized immediately.
	if (['queued', 'scheduled', 'paused'].includes(row.status)) return finalize(row, 'cancelled', { note: 'cancelled before the next step' });
	return row;
}

/** Pause or resume a run, or raise its budget. */
export async function updateRun(runId, userId, { action = null, budgetCreditsUsd = null, budgetUsd = null } = {}) {
	const run = await getOwnedRun(runId, userId);
	if (TERMINAL.has(run.status)) throw apiError(409, 'run_finished', `This run already ${run.status}.`);
	let status = run.status;
	if (action === 'pause') status = 'paused';
	else if (action === 'resume') status = run.status === 'paused' ? (run.step_count > 0 ? 'running' : 'queued') : run.status;
	else if (action) throw apiError(400, 'bad_action', 'action must be pause or resume.');
	const credits = budgetCreditsUsd == null ? toNumber(run.budget_credits_usd) : Number(budgetCreditsUsd);
	const usd = budgetUsd == null ? toNumber(run.budget_usd) : Number(budgetUsd);
	if (credits < toNumber(run.budget_credits_usd) || usd < toNumber(run.budget_usd)) {
		throw apiError(400, 'budget_decrease', 'A budget can only be raised.');
	}
	const [row] = await sql`
		UPDATE agent_runs SET status = ${status}, budget_credits_usd = ${credits}, budget_usd = ${usd}, updated_at = now()
		WHERE id = ${runId} RETURNING *
	`;
	await insertSteps(runId, await lastSeq(runId), [{ kind: 'status', output: { status, action, budgetCreditsUsd: credits } }]);
	return row;
}

async function lastSeq(runId) {
	const [r] = await sql`SELECT coalesce(max(seq), 0)::int AS seq FROM agent_run_steps WHERE run_id = ${runId}`;
	return r.seq;
}

async function insertSteps(runId, fromSeq, events) {
	let seq = fromSeq;
	for (const e of events) {
		seq += 1;
		await sql`
			INSERT INTO agent_run_steps
				(run_id, seq, kind, provider, model, tool_name, input, output, input_tokens, output_tokens, cost_micro_usd, latency_ms)
			VALUES
				(${runId}, ${seq}, ${e.kind}, ${e.provider || null}, ${e.model || null}, ${e.tool || null},
				 ${e.input == null ? null : JSON.stringify(e.input)}::jsonb, ${e.output == null ? null : JSON.stringify(e.output)}::jsonb,
				 ${e.inputTokens ?? null}, ${e.outputTokens ?? null}, ${e.costMicroUsd ?? null}, ${e.latencyMs ?? null})
			ON CONFLICT (run_id, seq) DO NOTHING
		`;
	}
	return seq;
}

async function finalize(run, status, { result = null, error = null, note = null } = {}) {
	const [row] = await sql`
		UPDATE agent_runs
		SET status = ${status}, result = coalesce(${result}, result), error = ${error},
		    lease_owner = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
		WHERE id = ${run.id} RETURNING *
	`;
	await insertSteps(run.id, await lastSeq(run.id), [
		{ kind: status === 'completed' ? 'final' : status === 'failed' ? 'error' : 'status', output: { status, result, error, note } },
	]);
	return row;
}

async function acquireLease(runId, owner) {
	const [row] = await sql`
		UPDATE agent_runs
		SET lease_owner = ${owner}, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
		    status = CASE WHEN status IN ('queued', 'scheduled') THEN 'running' ELSE status END,
		    started_at = coalesce(started_at, now()), updated_at = now()
		WHERE id = ${runId}
		  AND status IN ('queued', 'scheduled', 'running')
		  AND (scheduled_for IS NULL OR scheduled_for <= now())
		  AND (lease_until IS NULL OR lease_until < now() OR lease_owner = ${owner})
		RETURNING *
	`;
	return row || null;
}

async function agentSystemPrompt(agentId) {
	const [a] = await sql`SELECT name, description, persona_prompt FROM agent_identities WHERE id = ${agentId} LIMIT 1`;
	const parts = [`You are ${a?.name || 'a three.ws agent'}, running an autonomous task on three.ws.`];
	if (a?.persona_prompt) parts.push(String(a.persona_prompt).slice(0, 4000));
	else if (a?.description) parts.push(String(a.description).slice(0, 1000));
	parts.push(AGENT_SYSTEM_NOTE);
	parts.push('Work the goal step by step. When you are done, answer with a concise report of what you found, what you produced, and what the human must do next.');
	return parts.join('\n\n');
}

function chainFor(run) {
	const chain = providerChainFor(run.model || null);
	if (toNumber(run.budget_credits_usd) > 0) return chain;
	return chain.filter((p) => isFreeLane(p.name, p.catalogModel || p.model));
}

function toolsFor(run) {
	const allow = Array.isArray(run.tools_allowed) ? new Set(run.tools_allowed) : null;
	const schemas = agentToolSchemas().filter((s) => !allow || allow.has(s.function.name));
	const all = agentToolHandlers();
	const handlers = Object.fromEntries(schemas.map((s) => [s.function.name, all[s.function.name]]));
	return { schemas, handlers };
}

/**
 * Advance a run by one loop step. Returns the updated row, or null when the
 * run is not steppable right now (finished, paused, not due, or leased).
 */
export async function stepRun(runId, { owner = `step:${randomUUID()}` } = {}) {
	const run = await acquireLease(runId, owner);
	if (!run) return null;

	if (run.cancel_requested_at) return finalize(run, 'cancelled', { note: 'cancelled by the owner' });

	const chain = chainFor(run);
	if (!chain.length) {
		return finalize(run, 'failed', {
			error: toNumber(run.budget_credits_usd) > 0
				? 'No model provider is available right now.'
				: 'No free model lane is available right now. Give the run a credit budget to use paid models.',
		});
	}

	// A run that can spend on paid lanes is held to its agent's inference
	// budget before every model step, the same budget chat completions and the
	// strategy loop answer to. The first refusal in a window stops the agent's
	// automations and notifies the owner (assertAgentBudget latches it).
	if (toNumber(run.budget_credits_usd) > 0) {
		const refused = await agentBudgetRefusal(run);
		if (refused) return finalize(run, 'budget_exhausted', refused);
	}

	const events = [];
	const { schemas, handlers } = toolsFor(run);
	const loop = createAgentLoop({
		chain,
		toolSchemas: schemas,
		toolHandlers: handlers,
		temperature: run.temperature == null ? 0.4 : Number(run.temperature),
		onEvent: (e) => {
			events.push(e);
		},
	});

	let checkpoint = run.checkpoint;
	if (!checkpoint) {
		checkpoint = initialLoopState({
			operationId: run.id,
			maxSteps: run.max_steps * RUNTIME_STEPS_PER_STEP,
			messages: [
				{ role: 'system', content: await agentSystemPrompt(run.agent_id) },
				{ role: 'user', content: run.goal },
			],
		});
	}

	let next;
	try {
		next = await loop.step(checkpoint.state, checkpoint.context);
	} catch (err) {
		await persistEvents(run, events);
		return finalize(run, 'failed', { error: String(err?.message || err).slice(0, 500) });
	}

	const { costUsd } = await persistEvents(run, events);

	let spent = toNumber(run.spent_credits_usd);
	if (costUsd > 0) {
		try {
			await debitCredits({
				userId: run.user_id,
				amountUsd: costUsd,
				action: 'agent_run_step',
				// Booked against the agent, so its inference budget counts run spend.
				refType: 'agent',
				refId: String(run.agent_id),
				idempotencyKey: `agent_run:${run.id}:${run.step_count + 1}`,
				meta: { agentId: run.agent_id, runId: run.id },
			});
			spent += costUsd;
		} catch (err) {
			if (err?.code === 'insufficient_credits') {
				return finalize(run, 'budget_exhausted', { error: 'Not enough credits to pay for the next model call. Top up to continue.' });
			}
			throw err;
		}
	}

	const stepCount = run.step_count + 1;
	const done = loopFinished(next.state, next.context);
	const [row] = await sql`
		UPDATE agent_runs
		SET checkpoint = ${JSON.stringify(next)}::jsonb, step_count = ${stepCount},
		    spent_credits_usd = ${spent}, lease_owner = NULL, lease_until = NULL, updated_at = now()
		WHERE id = ${run.id} RETURNING *
	`;

	if (done) {
		if (next.state.status === 'error') return finalize(row, 'failed', { error: next.state.error?.message || 'The agent loop ended with an error.' });
		return finalize(row, 'completed', { result: finalAnswer(next.state) || '(the agent returned no text)' });
	}
	if (toNumber(row.budget_credits_usd) > 0 && spent >= toNumber(row.budget_credits_usd)) {
		return finalize(row, 'budget_exhausted', { error: `Spent the ${toNumber(row.budget_credits_usd)} credit budget. Raise it to continue.` });
	}
	if (stepCount >= row.max_steps * RUNTIME_STEPS_PER_STEP) {
		return finalize(row, 'completed', { result: finalAnswer(next.state) || 'Reached the step limit before a final answer.' });
	}
	return row;
}

/** The run's refusal when its agent's inference budget is used up, else null. */
async function agentBudgetRefusal(run) {
	const [agent] = await sql`SELECT id, name, meta FROM agent_identities WHERE id = ${run.agent_id} LIMIT 1`;
	if (!agent) return null;
	try {
		await assertAgentBudget({ userId: run.user_id, agent });
		return null;
	} catch (err) {
		if (err instanceof InferenceBillingError) {
			return { error: err.message, note: err.code };
		}
		throw err;
	}
}

async function persistEvents(run, events) {
	let costUsd = 0;
	const rows = [];
	for (const e of events) {
		if (e.kind === 'model_call') {
			const paid = !e.free;
			if (paid) costUsd += Number(e.costMicroUsd || 0) / 1e6;
			rows.push({
				kind: 'model_call',
				provider: e.provider,
				model: e.model,
				output: { content: e.content ? String(e.content).slice(0, 8000) : '', toolCalls: e.toolCalls, free: Boolean(e.free), estimated: e.usage?.estimated },
				inputTokens: e.usage?.input ?? null,
				outputTokens: e.usage?.output ?? null,
				costMicroUsd: paid ? Math.round(Number(e.costMicroUsd || 0)) : 0,
				latencyMs: e.latencyMs ?? null,
			});
		} else if (e.kind === 'tool_call') {
			rows.push({ kind: 'tool_call', tool: e.tool, input: e.args });
		} else if (e.kind === 'tool_blocked') {
			rows.push({ kind: 'tool_blocked', tool: e.tool, input: e.args, output: { reason: e.reason } });
		} else if (e.kind === 'tool_result') {
			rows.push({ kind: 'tool_result', tool: e.tool, input: e.args, output: e.error ? { error: e.error } : e.result, latencyMs: e.latencyMs ?? null });
		}
	}
	if (rows.length) await insertSteps(run.id, await lastSeq(run.id), rows);
	return { costUsd };
}

/** Step a run until it finishes, pauses, or the deadline passes. */
export async function driveRun(runId, { deadlineMs = 25_000 } = {}) {
	const stop = Date.now() + deadlineMs;
	const owner = `drive:${randomUUID()}`;
	let row = null;
	while (Date.now() < stop) {
		const next = await stepRun(runId, { owner });
		if (!next) break;
		row = next;
		if (TERMINAL.has(next.status) || next.status === 'paused') break;
	}
	return row;
}

/** Drive every due run a little. The run cron calls this each minute. */
export async function driveDueRuns({ limit = 10, deadlineMs = 50_000 } = {}) {
	const due = await sql`
		SELECT id FROM agent_runs
		WHERE status IN ('queued', 'scheduled', 'running')
		  AND (scheduled_for IS NULL OR scheduled_for <= now())
		  AND (lease_until IS NULL OR lease_until < now())
		  AND NOT EXISTS (
		    SELECT 1 FROM agent_identities ai WHERE ai.id = agent_runs.agent_id AND ai.status = 'stopped'
		  )
		ORDER BY updated_at ASC
		LIMIT ${limit}
	`;
	const stop = Date.now() + deadlineMs;
	const report = { due: due.length, stepped: 0, finished: 0, errors: [] };
	await Promise.all(
		due.map(async ({ id }) => {
			try {
				const per = Math.max(5_000, stop - Date.now());
				const row = await driveRun(id, { deadlineMs: per });
				if (row) report.stepped++;
				if (row && TERMINAL.has(row.status)) report.finished++;
			} catch (err) {
				report.errors.push({ id, error: String(err?.message || err).slice(0, 200) });
			}
		}),
	);
	return report;
}
