// Agent evals as a service: run a suite against an owned agent, keep the report
// in agent_evals, list the history the Evaluate tab charts, and fetch one report.
//
// The route layer (api/v1/rest.js) streams progress to the caller while this
// module does the work, so everything that can be unit tested lives here and
// the route stays thin. Only credit-safe lanes (free lanes and Vertex Gemini,
// which bills the platform's GCP credits) can run through the API: a paid lane
// would bill the platform for a user's eval.

import { sql } from '../db.js';
import { apiError } from '../agents-v1/http.js';
import { agentConfig } from './configs.js';
import { evalRung, isCreditSafe, listEvalModels, ModelUnavailableError } from './models.js';
import { listSuiteNames, loadSuite, describeSuite, SuiteError } from './suites.js';
import { runSuite } from './runner.js';

/** Ceiling on measured model spend for one API-started eval. */
export const API_EVAL_MAX_COST_USD = 0.25;
/** A running row older than this is a crashed run, not a live one. */
const STALE_RUNNING_MS = 15 * 60_000;
const DEFAULT_MODEL = 'vertex/google/gemini-2.5-flash';

const toNum = (v) => (v == null ? null : Number(v));

/** Public projection of an agent_evals row (the report is fetched separately). */
export function serializeEval(r) {
	return {
		id: r.id,
		agentId: r.agent_id,
		suite: r.suite,
		suiteVersion: r.suite_version,
		model: r.model,
		configVersion: r.config_version,
		status: r.status,
		score: toNum(r.score),
		passRate: toNum(r.pass_rate),
		costUsd: toNum(r.cost_usd),
		summary: r.summary ?? null,
		error: r.error ?? null,
		createdAt: r.created_at,
		finishedAt: r.finished_at,
	};
}

/** The suites an Evaluate tab can offer, with the models that can run them here. */
export async function evalCatalog() {
	const suites = listSuiteNames().map((name) => {
		try {
			return describeSuite(loadSuite(name));
		} catch (err) {
			if (err instanceof SuiteError) return { name, invalid: true, problems: err.problems };
			throw err;
		}
	});
	const models = listEvalModels().filter((m) => m.free || m.credits);
	return { suites, models, defaultModel: models.find((m) => m.id === DEFAULT_MODEL)?.id || models[0]?.id || null };
}

/** Resolve the request into everything a run needs, or throw a typed 4xx. */
export function resolveEvalRequest(agent, { suite: suiteName, model } = {}) {
	if (typeof suiteName !== 'string' || !listSuiteNames().includes(suiteName)) {
		throw apiError(400, 'invalid_parameter', `suite is required. Suites: ${listSuiteNames().join(', ')}.`, { parameter: 'suite' });
	}
	let suite;
	try {
		suite = loadSuite(suiteName);
	} catch (err) {
		if (err instanceof SuiteError) throw apiError(404, 'unknown_suite', err.message, { parameter: 'suite' });
		throw err;
	}
	const modelId = model || agent.meta?.runtime?.model || DEFAULT_MODEL;
	let rung;
	try {
		rung = evalRung(modelId);
	} catch (err) {
		if (err instanceof ModelUnavailableError) throw apiError(400, 'model_unavailable', err.message, { parameter: 'model' });
		throw err;
	}
	if (!isCreditSafe(rung)) {
		throw apiError(400, 'model_not_allowed', `${modelId} is a paid lane, which an eval started over the API cannot use. Pick a free model or a vertex/ model (GET /api/v1/evals/catalog).`, { parameter: 'model' });
	}
	const config = agentConfig(agent, suite.defaults || {});
	return { suite, rung, config, model: modelId };
}

async function assertNoneRunning(agentId) {
	const [row] = await sql`
		SELECT id, created_at FROM agent_evals
		WHERE agent_id = ${agentId} AND status = 'running' AND created_at > now() - ${STALE_RUNNING_MS / 1000} * interval '1 second'
		LIMIT 1
	`;
	if (row) throw apiError(409, 'eval_in_progress', 'An eval is already running for this agent. Wait for it to finish.', { evalId: row.id });
}

/**
 * Run a suite against an owned agent and persist the report.
 * `onTask` receives each scored task row as it lands, for SSE progress.
 */
export async function runAgentEval(agent, userId, request, { onStart, onTask } = {}) {
	const { suite, rung, config, model } = resolveEvalRequest(agent, request);
	await assertNoneRunning(agent.id);
	const [row] = await sql`
		INSERT INTO agent_evals (agent_id, user_id, suite, suite_version, model, config_version, status)
		VALUES (${agent.id}, ${userId}, ${suite.name}, ${suite.version}, ${model}, ${config.version}, 'running')
		RETURNING *
	`;
	if (onStart) await onStart({ ...serializeEval(row), tasks: suite.tasks.length });
	try {
		const report = await runSuite(suite, config, { rung, model, target: 'api', onTask, maxCostUsd: API_EVAL_MAX_COST_USD });
		const [done] = await sql`
			UPDATE agent_evals
			SET status = 'completed', score = ${report.summary.score}, pass_rate = ${report.summary.passRate},
			    cost_usd = ${report.summary.costUsd}, summary = ${JSON.stringify(report.summary)}::jsonb,
			    report = ${JSON.stringify(report)}::jsonb, finished_at = now()
			WHERE id = ${row.id} RETURNING *
		`;
		return { eval: serializeEval(done), report };
	} catch (err) {
		await sql`UPDATE agent_evals SET status = 'failed', error = ${String(err?.message || err).slice(0, 500)}, finished_at = now() WHERE id = ${row.id}`;
		throw err;
	}
}

/** The agent's eval history, newest first, without the heavy report column. */
export async function listAgentEvals(agentId, { limit = 25, cursor = null, suite = null } = {}) {
	let anchor = null;
	if (cursor) {
		[anchor] = await sql`SELECT created_at, id FROM agent_evals WHERE id = ${cursor} AND agent_id = ${agentId}`;
		if (!anchor) throw apiError(400, 'invalid_cursor', 'cursor must be a value returned in meta.nextCursor.', { parameter: 'cursor' });
	}
	const rows = await sql`
		SELECT id, agent_id, suite, suite_version, model, config_version, status, score, pass_rate, cost_usd, summary, error, created_at, finished_at
		FROM agent_evals
		WHERE agent_id = ${agentId}
		  AND (${suite}::text IS NULL OR suite = ${suite})
		  AND (${anchor?.created_at ?? null}::timestamptz IS NULL
		       OR (created_at, id) < (${anchor?.created_at ?? null}::timestamptz, ${anchor?.id ?? null}::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT ${limit + 1}
	`;
	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit).map(serializeEval);
	return { items, hasMore, nextCursor: hasMore ? items.at(-1).id : null };
}

/** One eval with its full report. */
export async function getAgentEval(agentId, evalId) {
	const [row] = await sql`SELECT * FROM agent_evals WHERE id = ${evalId} AND agent_id = ${agentId}`;
	if (!row) throw apiError(404, 'not_found', 'No eval with that id on this agent.');
	return { ...serializeEval(row), report: row.report ?? null };
}
