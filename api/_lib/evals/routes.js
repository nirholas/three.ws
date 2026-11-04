// v1 routes for agent evals, run replay and trajectory export (mounted by
// api/v1/rest.js beside the other agent sub-resources).
//
//   GET  /evals/catalog                      suites and the models that can run them here
//   POST /agents/:id/evals                   run a suite; Accept: text/event-stream streams progress
//   GET  /agents/:id/evals                   score history, newest first
//   GET  /agents/:id/evals/:eval             one eval with its full report
//   GET  /agents/:id/runs/:run/replay        deterministic replay of a recorded run
//   POST /agents/:id/runs/:run/replay        re-run the goal on a model with side effects previewed
//   GET  /agents/:id/runs/:run/trajectory    the run as redacted JSONL

import { apiError, created, intParam, page, requireUuid, strParam } from '../agents-v1/http.js';
import { loadOwnedAgent } from '../agents-v1/agents.js';
import { agentSystemPrompt, getOwnedRun, listRunSteps, serializeRun } from '../agents-v1/runs.js';
import { evalCatalog, getAgentEval, listAgentEvals, resolveEvalRequest, runAgentEval } from './service.js';
import { buildReplay, buildTrajectory, rerunPreview } from './replay.js';
import { evalRung, isCreditSafe, ModelUnavailableError } from './models.js';

const R = (method, path, name, scope, handler, extra = {}) => ({ method, path, name, auth: 'required', scope, handler, ...extra });

const STEP_PAGE = 500;
const MAX_STEPS = 5000;

async function ownedAgent(params, principal) {
	return loadOwnedAgent(requireUuid(params.id, 'agent'), principal.userId);
}

/** A run of this agent, with every recorded step (the steps endpoint pages at 500). */
async function loadRun(params, principal) {
	const agent = await ownedAgent(params, principal);
	const row = await getOwnedRun(requireUuid(params.run, 'run'), principal.userId);
	if (row.agent_id !== agent.id) throw apiError(404, 'run_not_found', 'That run belongs to a different agent.');
	const steps = [];
	for (let after = 0; steps.length < MAX_STEPS; ) {
		const chunk = await listRunSteps(row.id, principal.userId, { after, limit: STEP_PAGE });
		steps.push(...chunk);
		if (chunk.length < STEP_PAGE) break;
		after = chunk.at(-1).seq;
	}
	return { agent, run: serializeRun(row), steps };
}

function wantsStream(req) {
	return String(req.headers.accept || '').includes('text/event-stream');
}

async function runEvalRoute({ req, res, params, principal, body }) {
	const agent = await ownedAgent(params, principal);
	const suite = strParam(body.suite, { name: 'suite', max: 48, required: true });
	const model = strParam(body.model, { name: 'model', max: 120 });
	if (!wantsStream(req)) {
		const out = await runAgentEval(agent, principal.userId, { suite, model });
		return created({ ...out.eval, report: out.report });
	}

	// Validate before the first byte so a bad suite or model is a plain 4xx.
	resolveEvalRequest(agent, { suite, model });
	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		'x-accel-buffering': 'no',
		connection: 'keep-alive',
	});
	let closed = false;
	req.on('close', () => {
		closed = true;
	});
	const send = (event, data) => {
		if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};
	const beat = setInterval(() => {
		if (!closed && !res.writableEnded) res.write(': keepalive\n\n');
	}, 15_000);
	try {
		const out = await runAgentEval(agent, principal.userId, { suite, model }, {
			onStart: (e) => send('start', e),
			onTask: (row, index, total) =>
				send('task', {
					index,
					total,
					id: row.id,
					title: row.title,
					status: row.status,
					score: row.score,
					steps: row.trace.steps,
					costUsd: row.trace.costUsd,
					latencyMs: row.trace.latencyMs,
					tools: row.trace.toolCalls.map((c) => c.tool),
					failedChecks: row.checks.filter((c) => !c.passed).map((c) => c.detail),
					error: row.error,
				}),
		});
		send('done', { ...out.eval, report: out.report });
	} catch (err) {
		send('error', { code: err?.code || 'eval_failed', message: String(err?.message || err).slice(0, 300) });
	} finally {
		clearInterval(beat);
		if (!res.writableEnded) res.end();
	}
}

export const EVAL_ROUTES = [
	R('GET', '/evals/catalog', 'evals.catalog', 'agents:read', () => evalCatalog()),
	R('POST', '/agents/:id/evals', 'evals.run', 'agents:write', runEvalRoute),
	R('GET', '/agents/:id/evals', 'evals.list', 'agents:read', async ({ params, principal, query }) => {
		const agent = await ownedAgent(params, principal);
		const out = await listAgentEvals(agent.id, {
			limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 }),
			cursor: query.cursor ? requireUuid(query.cursor, 'cursor') : null,
			suite: strParam(query.suite, { name: 'suite', max: 48 }),
		});
		return page(out.items, out);
	}),
	R('GET', '/agents/:id/evals/:eval', 'evals.get', 'agents:read', async ({ params, principal }) => {
		const agent = await ownedAgent(params, principal);
		return getAgentEval(agent.id, requireUuid(params.eval, 'eval'));
	}),
	R('GET', '/agents/:id/runs/:run/replay', 'runs.replay', 'agents:read', async ({ params, principal }) => {
		const { run, steps } = await loadRun(params, principal);
		return buildReplay(run, steps);
	}),
	R('POST', '/agents/:id/runs/:run/replay', 'runs.replay.preview', 'agents:write', async ({ params, principal, body }) => {
		const { agent, run, steps } = await loadRun(params, principal);
		const model = strParam(body.model, { name: 'model', max: 120, required: true });
		let rung;
		try {
			rung = evalRung(model);
		} catch (err) {
			if (err instanceof ModelUnavailableError) throw apiError(400, 'model_unavailable', err.message, { parameter: 'model' });
			throw err;
		}
		if (!isCreditSafe(rung)) {
			throw apiError(400, 'model_not_allowed', `${model} is a paid lane. Replay over the API uses free models or vertex/ models (GET /api/v1/evals/catalog).`, { parameter: 'model' });
		}
		const systemPrompt = await agentSystemPrompt(agent.id);
		return created(await rerunPreview({ run, steps, systemPrompt, model, rung }));
	}),
	R('GET', '/agents/:id/runs/:run/trajectory', 'runs.trajectory', 'agents:read', async ({ params, principal, res }) => {
		const { run, steps } = await loadRun(params, principal);
		const body = `${buildTrajectory(run, steps).join('\n')}\n`;
		res.writeHead(200, {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'content-disposition': `attachment; filename="trajectory-${run.id}.jsonl"`,
			'cache-control': 'no-store',
		});
		res.end(body);
	}),
];
