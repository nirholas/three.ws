// Sandbox persistence: runs, executions and per-account settings.
// Schema: api/_lib/migrations/20260922220000_agent_sandbox.sql.

import { sql } from '../db.js';

const BRIDGE_LOG_CAP = 200;

export class SandboxError extends Error {
	constructor(status, code, message, detail = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
		this.expose = true;
	}
}

// ── runs ─────────────────────────────────────────────────────────────────────

/**
 * Create the sandbox row for a run, or return the existing one. The backend is
 * pinned on first use: a run's workspace and terminal session belong to one
 * backend for its whole life.
 */
export async function ensureSandboxRun({ runId, userId, agentId = null, backend, title = null, toolsAllowed = null }) {
	const [row] = await sql`
		insert into sandbox_runs (run_id, user_id, agent_id, backend, title, tools_allowed)
		values (${runId}, ${userId}, ${agentId}, ${backend}, ${title ? String(title).slice(0, 200) : null}, ${toolsAllowed})
		on conflict (run_id) do update set updated_at = sandbox_runs.updated_at
		returning *
	`;
	if (String(row.user_id) !== String(userId)) {
		throw new SandboxError(403, 'forbidden', 'this run belongs to another account');
	}
	return row;
}

export async function getSandboxRun(runId) {
	const [row] = await sql`select * from sandbox_runs where run_id = ${runId}`;
	return row || null;
}

export async function listSandboxRuns(userId, { limit = 20 } = {}) {
	return sql`
		select run_id, agent_id, backend, title, status, killed_reason, execution_count, bridge_calls,
		       cost_usd, wall_ms, created_at, updated_at
		from sandbox_runs where user_id = ${userId}
		order by updated_at desc limit ${Math.min(100, Math.max(1, limit))}
	`;
}

export async function killSandboxRun(runId, reason) {
	const [row] = await sql`
		update sandbox_runs
		set status = 'killed', killed_reason = ${String(reason).slice(0, 500)}, killed_at = now(), updated_at = now()
		where run_id = ${runId} and status = 'active'
		returning *
	`;
	return row || null;
}

/** Fold one finished execution into the run totals; returns the updated run. */
export async function recordRunTotals(runId, { costUsd, wallMs, failed }) {
	const [row] = await sql`
		update sandbox_runs
		set cost_usd = cost_usd + ${costUsd},
		    wall_ms = wall_ms + ${Math.max(0, Math.round(wallMs || 0))},
		    failures_streak = case when ${failed} then failures_streak + 1 else 0 end,
		    updated_at = now()
		where run_id = ${runId}
		returning *
	`;
	return row || null;
}

export async function countRecentExecutions(runId, seconds) {
	const [row] = await sql`
		select count(*)::int as n from sandbox_executions
		where run_id = ${runId} and created_at > now() - make_interval(secs => ${seconds})
	`;
	return row?.n || 0;
}

// ── executions ───────────────────────────────────────────────────────────────

/**
 * Insert an execution with the next sequence number for its run, atomically
 * with the run's execution counter, refusing when the run is killed or at its
 * execution cap.
 */
export async function createExecution({ runId, userId, kind, backend, language, code, limits }) {
	const [run] = await sql`
		update sandbox_runs set execution_count = execution_count + 1, updated_at = now()
		where run_id = ${runId} and status = 'active' and execution_count < ${limits.executionsPerRun}
		returning execution_count
	`;
	if (!run) {
		const current = await getSandboxRun(runId);
		if (current?.status === 'killed') {
			throw new SandboxError(409, 'run_killed', `This run's sandbox was stopped: ${current.killed_reason || 'killed'}.`, {
				reason: current.killed_reason,
			});
		}
		throw new SandboxError(429, 'execution_limit', `This run has used all ${limits.executionsPerRun} executions its plan allows.`, {
			limit: limits.executionsPerRun,
			plan: limits.plan,
		});
	}
	const [row] = await sql`
		insert into sandbox_executions (run_id, user_id, seq, kind, backend, language, code, status, limits, started_at)
		values (${runId}, ${userId}, ${run.execution_count}, ${kind}, ${backend}, ${language}, ${code}, 'running',
		        ${JSON.stringify(limits)}::jsonb, now())
		returning *
	`;
	return row;
}

export async function getExecution(id) {
	if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
	const [row] = await sql`select * from sandbox_executions where id = ${id}`;
	return row || null;
}

export async function listExecutions(runId, { limit = 100 } = {}) {
	return sql`
		select id, seq, kind, backend, language, code, status, exit_code, stdout, stderr, stdout_truncated,
		       stderr_truncated, files_out, files_deleted, bridge_calls, bridge_log, limits, wall_ms, cpu_ms,
		       peak_memory_mb, cost_usd, charged_usd, error, created_at, started_at, finished_at
		from sandbox_executions where run_id = ${runId}
		order by seq desc limit ${Math.min(500, Math.max(1, limit))}
	`;
}

/**
 * Write an execution's outcome. Only a running execution can finish, so a late
 * report from a runner cannot overwrite a result the API already recorded.
 */
export async function finishExecution(id, r) {
	const [row] = await sql`
		update sandbox_executions set
			status = ${r.status},
			exit_code = ${r.exitCode ?? null},
			stdout = ${r.stdout ?? ''},
			stderr = ${r.stderr ?? ''},
			stdout_truncated = ${Boolean(r.stdoutTruncated)},
			stderr_truncated = ${Boolean(r.stderrTruncated)},
			files_out = ${JSON.stringify(r.filesOut || [])}::jsonb,
			files_deleted = ${JSON.stringify(r.filesDeleted || [])}::jsonb,
			wall_ms = ${r.wallMs ?? null},
			cpu_ms = ${r.cpuMs ?? null},
			peak_memory_mb = ${r.peakMemoryMb ?? null},
			error = ${r.error ? String(r.error).slice(0, 2000) : null},
			finished_at = now()
		where id = ${id} and status in ('queued', 'running')
		returning *
	`;
	return row || null;
}

export async function setExecutionCost(id, { costUsd, chargedUsd }) {
	await sql`update sandbox_executions set cost_usd = ${costUsd}, charged_usd = ${chargedUsd} where id = ${id}`;
}

export async function setExecutionExternalId(id, externalId) {
	await sql`update sandbox_executions set external_id = ${externalId} where id = ${id}`;
}

/**
 * Count one bridge call against its execution and append it to the log.
 * Returns the new count, or null when the execution is no longer running.
 */
export async function recordBridgeCall(execId, entry) {
	const [row] = await sql`
		update sandbox_executions set
			bridge_calls = bridge_calls + 1,
			bridge_log = case when jsonb_array_length(bridge_log) < ${BRIDGE_LOG_CAP}
				then bridge_log || ${JSON.stringify([entry])}::jsonb else bridge_log end
		where id = ${execId} and status = 'running'
		returning bridge_calls, run_id
	`;
	if (!row) return null;
	await sql`
		update sandbox_runs set bridge_calls = bridge_calls + 1,
			refusals = refusals + ${entry.ok ? 0 : entry.financial ? 1 : 0}, updated_at = now()
		where run_id = ${row.run_id}
	`;
	return row.bridge_calls;
}

// ── settings ─────────────────────────────────────────────────────────────────

export async function getSandboxSettings(userId) {
	const [row] = await sql`select * from sandbox_settings where user_id = ${userId}`;
	return row || null;
}

/** Upsert the columns present in `patch`; absent keys keep their stored value. */
export async function saveSandboxSettings(userId, patch) {
	const has = (k) => Object.hasOwn(patch, k);
	const [row] = await sql`
		insert into sandbox_settings (user_id, default_backend, allow_hosts, ssh_host, ssh_port, ssh_username,
			ssh_host_key_sha256, ssh_public_key, ssh_private_key_enc, ssh_verified_at, docker_image)
		values (${userId}, ${patch.default_backend ?? 'cloudrun'}, ${patch.allow_hosts ?? []}, ${patch.ssh_host ?? null},
			${patch.ssh_port ?? 22}, ${patch.ssh_username ?? null}, ${patch.ssh_host_key_sha256 ?? null},
			${patch.ssh_public_key ?? null}, ${patch.ssh_private_key_enc ?? null}, ${patch.ssh_verified_at ?? null},
			${patch.docker_image ?? null})
		on conflict (user_id) do update set
			default_backend = case when ${has('default_backend')} then excluded.default_backend else sandbox_settings.default_backend end,
			allow_hosts = case when ${has('allow_hosts')} then excluded.allow_hosts else sandbox_settings.allow_hosts end,
			ssh_host = case when ${has('ssh_host')} then excluded.ssh_host else sandbox_settings.ssh_host end,
			ssh_port = case when ${has('ssh_port')} then excluded.ssh_port else sandbox_settings.ssh_port end,
			ssh_username = case when ${has('ssh_username')} then excluded.ssh_username else sandbox_settings.ssh_username end,
			ssh_host_key_sha256 = case when ${has('ssh_host_key_sha256')} then excluded.ssh_host_key_sha256 else sandbox_settings.ssh_host_key_sha256 end,
			ssh_public_key = case when ${has('ssh_public_key')} then excluded.ssh_public_key else sandbox_settings.ssh_public_key end,
			ssh_private_key_enc = case when ${has('ssh_private_key_enc')} then excluded.ssh_private_key_enc else sandbox_settings.ssh_private_key_enc end,
			ssh_verified_at = case when ${has('ssh_verified_at')} then excluded.ssh_verified_at else sandbox_settings.ssh_verified_at end,
			docker_image = case when ${has('docker_image')} then excluded.docker_image else sandbox_settings.docker_image end,
			updated_at = now()
		returning *
	`;
	return row;
}

export async function getUserPlan(userId) {
	const [row] = await sql`select plan from users where id = ${userId}`;
	return row?.plan || 'free';
}
