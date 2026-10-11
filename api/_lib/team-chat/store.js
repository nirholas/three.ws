// Persistence for coordinator runs: runs, their steps and the event stream.
//
// The runner (runner.js) only ever talks to the store through this interface,
// so the escalation tests drive the same runner against an in-memory store
// (tests/team-chat-escalation.test.js) and production drives it against Neon.
//
// Every status change that matters for money is a conditional update
// (claimStep): two requests racing to approve, or an approval arriving from the
// inbox while the chat stream is open, can never execute a step twice.

import { sql } from '../db.js';

const RUN_COLUMNS = sql`
	id, user_id, squad_id, squad_kind, policy_agent_id, utterance, mode, network,
	planner, plan, status, summary, created_at, updated_at
`;

const STEP_COLUMNS = sql`
	id, run_id, idx, step_key, role, kind, title, params, depends_on, agent_id, status,
	evidence, result, approval, approval_request_id, error, started_at, finished_at, updated_at
`;

export function createSqlStore() {
	return {
		async createRun({ userId, squad, utterance, mode, plan, planner }) {
			const [row] = await sql`
				insert into team_chat_runs
					(user_id, squad_id, squad_kind, policy_agent_id, utterance, mode, network, planner, plan, status)
				values
					(${userId}, ${squad.id}, ${squad.kind}, ${squad.policy_agent_id}, ${utterance}, ${mode},
					 ${squad.network}, ${planner}, ${JSON.stringify(plan)}::jsonb, 'running')
				returning ${RUN_COLUMNS}
			`;
			return row;
		},

		async insertSteps(runId, steps) {
			const out = [];
			for (let i = 0; i < steps.length; i++) {
				const s = steps[i];
				const [row] = await sql`
					insert into team_chat_steps (run_id, idx, step_key, role, kind, title, params, depends_on, agent_id, status)
					values (${runId}, ${i}, ${s.key}, ${s.role}, ${s.kind}, ${s.title.slice(0, 200)},
					        ${JSON.stringify(s.params || {})}::jsonb, ${s.depends_on || []}::text[], ${s.agent_id || null}, 'queued')
					returning ${STEP_COLUMNS}
				`;
				out.push(row);
			}
			return out;
		},

		async getRun(runId, userId) {
			const [row] = await sql`select ${RUN_COLUMNS} from team_chat_runs where id = ${runId} and user_id = ${userId} limit 1`;
			return row || null;
		},

		async getRunById(runId) {
			const [row] = await sql`select ${RUN_COLUMNS} from team_chat_runs where id = ${runId} limit 1`;
			return row || null;
		},

		async listRuns(userId, squadId, limit = 20) {
			return sql`
				select ${RUN_COLUMNS} from team_chat_runs
				where user_id = ${userId} and squad_id = ${squadId}
				order by created_at desc limit ${Math.max(1, Math.min(50, limit))}
			`;
		},

		async updateRun(runId, patch) {
			const [row] = await sql`
				update team_chat_runs set
					status = coalesce(${patch.status ?? null}, status),
					summary = coalesce(${patch.summary ? JSON.stringify(patch.summary) : null}::jsonb, summary),
					updated_at = now()
				where id = ${runId}
				returning ${RUN_COLUMNS}
			`;
			return row || null;
		},

		/** Take the run's advance lease. False when another request holds it. */
		async lockRun(runId, ms) {
			const rows = await sql`
				update team_chat_runs set lock_until = now() + make_interval(secs => ${ms / 1000})
				where id = ${runId} and (lock_until is null or lock_until < now())
				returning id
			`;
			return rows.length > 0;
		},

		async unlockRun(runId) {
			await sql`update team_chat_runs set lock_until = null where id = ${runId}`;
		},

		async getSteps(runId) {
			return sql`select ${STEP_COLUMNS} from team_chat_steps where run_id = ${runId} order by idx`;
		},

		async getStep(stepId) {
			const [row] = await sql`select ${STEP_COLUMNS} from team_chat_steps where id = ${stepId} limit 1`;
			return row || null;
		},

		async getStepByApproval(approvalRequestId) {
			const [row] = await sql`select ${STEP_COLUMNS} from team_chat_steps where approval_request_id = ${approvalRequestId} limit 1`;
			return row || null;
		},

		/**
		 * Move a step from one of `from` to `to`, applying `patch`, only if it is
		 * still in one of `from`. Returns the updated row, or null when it lost.
		 */
		async claimStep(stepId, from, to, patch = {}) {
			const [row] = await sql`
				update team_chat_steps set
					status = ${to},
					evidence = coalesce(${patch.evidence ? JSON.stringify(patch.evidence) : null}::jsonb, evidence),
					result = coalesce(${patch.result ? JSON.stringify(patch.result) : null}::jsonb, result),
					approval = coalesce(${patch.approval ? JSON.stringify(patch.approval) : null}::jsonb, approval),
					approval_request_id = coalesce(${patch.approval_request_id ?? null}::uuid, approval_request_id),
					agent_id = coalesce(${patch.agent_id ?? null}::uuid, agent_id),
					error = ${patch.error ?? null},
					started_at = case when ${to} = 'running' or ${to} = 'executing' then coalesce(started_at, now()) else started_at end,
					finished_at = case when ${to} in ('done', 'failed', 'skipped', 'denied', 'expired') then now() else null end,
					updated_at = now()
				where id = ${stepId} and status = any(${from}::text[])
				returning ${STEP_COLUMNS}
			`;
			return row || null;
		},

		async setApprovalRequestId(stepId, approvalRequestId) {
			await sql`update team_chat_steps set approval_request_id = ${approvalRequestId}, updated_at = now() where id = ${stepId}`;
		},

		async appendEvent(runId, stepId, kind, payload) {
			const [row] = await sql`
				insert into team_chat_events (run_id, step_id, kind, payload)
				values (${runId}, ${stepId || null}, ${kind}, ${JSON.stringify(payload || {})}::jsonb)
				returning id, run_id, step_id, kind, payload, created_at
			`;
			return row;
		},

		async listEvents(runId, afterId = 0, limit = 500) {
			return sql`
				select id, run_id, step_id, kind, payload, created_at from team_chat_events
				where run_id = ${runId} and id > ${Number(afterId) || 0}
				order by id limit ${limit}
			`;
		},
	};
}

/**
 * The same interface in memory. Used by the escalation tests, and handy for a
 * dry run of the runner without a database.
 */
export function createMemoryStore() {
	const runs = new Map();
	const steps = new Map();
	const events = [];
	let seq = 0;
	let ids = 0;
	const uuid = () => {
		ids += 1;
		return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
	};
	const now = () => new Date().toISOString();
	const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
	const TERMINAL = ['done', 'failed', 'skipped', 'denied', 'expired'];

	return {
		runs,
		steps,
		events,
		async createRun({ userId, squad, utterance, mode, plan, planner }) {
			const row = { id: uuid(), user_id: userId, squad_id: squad.id, squad_kind: squad.kind, policy_agent_id: squad.policy_agent_id, utterance, mode, network: squad.network, planner, plan: clone(plan), status: 'running', summary: null, lock_until: 0, created_at: now(), updated_at: now() };
			runs.set(row.id, row);
			return clone(row);
		},
		async insertSteps(runId, list) {
			return list.map((s, i) => {
				const row = { id: uuid(), run_id: runId, idx: i, step_key: s.key, role: s.role, kind: s.kind, title: s.title, params: clone(s.params || {}), depends_on: [...(s.depends_on || [])], agent_id: s.agent_id || null, status: 'queued', evidence: {}, result: null, approval: null, approval_request_id: null, error: null, started_at: null, finished_at: null, updated_at: now() };
				steps.set(row.id, row);
				return clone(row);
			});
		},
		async getRun(runId, userId) {
			const r = runs.get(runId);
			return r && r.user_id === userId ? clone(r) : null;
		},
		async getRunById(runId) {
			return clone(runs.get(runId) || null);
		},
		async listRuns(userId, squadId, limit = 20) {
			return [...runs.values()].filter((r) => r.user_id === userId && r.squad_id === squadId).reverse().slice(0, limit).map(clone);
		},
		async updateRun(runId, patch) {
			const r = runs.get(runId);
			if (!r) return null;
			if (patch.status) r.status = patch.status;
			if (patch.summary) r.summary = clone(patch.summary);
			r.updated_at = now();
			return clone(r);
		},
		async lockRun(runId, ms) {
			const r = runs.get(runId);
			if (!r || r.lock_until > Date.now()) return false;
			r.lock_until = Date.now() + ms;
			return true;
		},
		async unlockRun(runId) {
			const r = runs.get(runId);
			if (r) r.lock_until = 0;
		},
		async getSteps(runId) {
			return [...steps.values()].filter((s) => s.run_id === runId).sort((a, b) => a.idx - b.idx).map(clone);
		},
		async getStep(stepId) {
			return clone(steps.get(stepId) || null);
		},
		async getStepByApproval(approvalRequestId) {
			return clone([...steps.values()].find((s) => s.approval_request_id === approvalRequestId) || null);
		},
		async claimStep(stepId, from, to, patch = {}) {
			const s = steps.get(stepId);
			if (!s || !from.includes(s.status)) return null;
			s.status = to;
			for (const k of ['evidence', 'result', 'approval', 'approval_request_id', 'agent_id']) if (patch[k] != null) s[k] = clone(patch[k]);
			s.error = patch.error ?? null;
			if ((to === 'running' || to === 'executing') && !s.started_at) s.started_at = now();
			s.finished_at = TERMINAL.includes(to) ? now() : null;
			s.updated_at = now();
			return clone(s);
		},
		async setApprovalRequestId(stepId, approvalRequestId) {
			const s = steps.get(stepId);
			if (s) s.approval_request_id = approvalRequestId;
		},
		async appendEvent(runId, stepId, kind, payload) {
			seq += 1;
			const row = { id: seq, run_id: runId, step_id: stepId || null, kind, payload: clone(payload || {}), created_at: now() };
			events.push(row);
			return clone(row);
		},
		async listEvents(runId, afterId = 0, limit = 500) {
			return events.filter((e) => e.run_id === runId && e.id > afterId).slice(0, limit).map(clone);
		},
	};
}
