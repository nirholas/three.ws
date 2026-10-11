/**
 * Run replay for the agent page's Runs tab (src/agent-run-replay.js).
 *
 *   GET  /api/agent-run-replay?agent=<agent_id>[&before=<run_id>]
 *        the agent's runs, newest first, 25 per page
 *   GET  /api/agent-run-replay?run=<run_id>[&after=<seq>]
 *        one run with its steps, every tool call paired with its result and
 *        receipt, and the receipt chain recomputed server-side
 *   POST /api/agent-run-replay?run=<run_id>&action=cancel
 *        stop the run before its next step
 *
 * Owner-only. The same data the MCP tools return (get_agent_run_steps,
 * cancel_agent_run), read through the same agents-v1 run library, so the page
 * and an MCP client always agree on what a run did.
 */
import { sql } from './_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from './_lib/auth.js';
import { cors, error, json, method, wrap, rateLimited } from './_lib/http.js';
import { requireCsrf } from './_lib/csrf.js';
import { clientIp, limits } from './_lib/rate-limit.js';
import { ApiError } from './_lib/agents-v1/http.js';
import { loadOwnedAgent } from './_lib/agents-v1/agents.js';
import { cancelRun, getOwnedRun, listRunSteps, serializeRun, TERMINAL_RUN_STATUSES } from './_lib/agents-v1/runs.js';
import { toolTraces, verifyReceiptChain } from './_lib/agents-v1/run-receipts.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNS_PAGE = 25;
const STEPS_PAGE = 500;

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

async function listRuns(agentId, before) {
	let anchor = null;
	if (before) {
		[anchor] = await sql`SELECT created_at, id FROM agent_runs WHERE id = ${before} AND agent_id = ${agentId}`;
		if (!anchor) throw new ApiError(400, 'invalid_cursor', 'before must be a run id from this agent.');
	}
	// max_steps budgets model turns (one model call plus its tool batch), so the
	// list reports turns taken, not raw runtime steps.
	const rows = await sql`
		SELECT r.*, (
			SELECT count(*)::int FROM agent_run_steps s WHERE s.run_id = r.id AND s.kind = 'model_call'
		) AS turns
		FROM agent_runs r
		WHERE r.agent_id = ${agentId}
		  AND (${anchor?.created_at ?? null}::timestamptz IS NULL
		       OR (r.created_at, r.id) < (${anchor?.created_at ?? null}::timestamptz, ${anchor?.id ?? null}::uuid))
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT ${RUNS_PAGE + 1}
	`;
	const hasMore = rows.length > RUNS_PAGE;
	const items = rows.slice(0, RUNS_PAGE).map((row) => ({ ...serializeRun(row), turns: row.turns }));
	return { runs: items, hasMore, nextBefore: hasMore ? items.at(-1).id : null };
}

async function replay(runId, userId, after) {
	const run = await getOwnedRun(runId, userId);
	const fetched = await listRunSteps(runId, userId, { after, limit: STEPS_PAGE + 1 });
	const hasMore = fetched.length > STEPS_PAGE;
	const steps = fetched.slice(0, STEPS_PAGE);
	// The chain can only be recomputed from the first step, so verification is
	// reported for a full read and left null for an incremental poll.
	const receiptChain = after === 0 && !hasMore ? verifyReceiptChain(runId, steps) : null;
	return {
		run: serializeRun(run),
		live: !TERMINAL_RUN_STATUSES.has(run.status),
		steps,
		toolTraces: toolTraces(steps),
		receiptChain,
		nextAfter: steps.length ? steps.at(-1).seq : after,
		hasMore,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'Sign in to see this agent\'s runs.');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent');
	const runId = url.searchParams.get('run');
	if (agentId && !UUID.test(agentId)) return error(res, 400, 'validation_error', 'agent must be an agent id.');
	if (runId && !UUID.test(runId)) return error(res, 400, 'validation_error', 'run must be a run id.');
	if (!agentId && !runId) return error(res, 400, 'validation_error', 'Pass ?agent=<agent_id> to list runs or ?run=<run_id> to replay one.');

	try {
		if (req.method === 'POST') {
			if (!runId || url.searchParams.get('action') !== 'cancel') {
				return error(res, 400, 'validation_error', 'POST takes ?run=<run_id>&action=cancel.');
			}
			if (!(await requireCsrf(req, res, auth.userId))) return;
			const rl = await limits.authIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const run = serializeRun(await cancelRun(runId, auth.userId));
			return json(res, 200, { data: { run, status: run.status === 'cancelled' ? 'cancelled' : 'cancel_requested' } });
		}

		const rl = await limits.widgetRead(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);

		if (runId) {
			const raw = url.searchParams.get('after');
			const after = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
			return json(res, 200, { data: await replay(runId, auth.userId, after) }, { 'cache-control': 'no-store' });
		}

		await loadOwnedAgent(agentId, auth.userId);
		const before = url.searchParams.get('before');
		if (before && !UUID.test(before)) return error(res, 400, 'validation_error', 'before must be a run id.');
		return json(res, 200, { data: await listRuns(agentId, before) }, { 'cache-control': 'no-store' });
	} catch (err) {
		if (err instanceof ApiError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});
