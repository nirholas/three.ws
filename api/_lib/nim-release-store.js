// @ts-check
// Queue and result store for day-0 NIM release evaluations (table
// nim_release_evals, migration 20261116170833_nim_release_evals.sql).
//
// The audit cron only ever calls enqueueReleaseEvals (a cheap insert, never
// the eval itself); /api/cron/nim-release-eval claims one row at a time with
// claimNextReleaseEval and settles it with completeReleaseEval or
// failReleaseEval. The admin board reads listReleaseEvals/getReleaseEval and
// can requeue a row.

import { sql } from './db.js';

/** Attempts before a row that keeps failing transiently is marked failed. */
export const MAX_ATTEMPTS = 3;
/** A row left `running` this long is treated as abandoned (the job died) and is claimable again. */
export const STALE_RUNNING_MINUTES = 30;

/**
 * Queue models for evaluation. Idempotent: a model id already in the table
 * (queued, done or failed) is left untouched, so the audit re-seeing an id, or
 * two audit runs racing, never queues it twice.
 * @param {Array<{ id: string, ownedBy?: string|null }>} models
 * @param {{ source?: string }} [opts]
 * @returns {Promise<Array<{ id: number, model_id: string }>>} the rows actually inserted
 */
export async function enqueueReleaseEvals(models, { source = 'catalog-watch' } = {}) {
	const rows = models
		.filter((m) => m && typeof m.id === 'string' && m.id.trim())
		.map((m) => ({ id: m.id.trim(), owned_by: m.ownedBy ?? null }));
	if (!rows.length) return [];
	return /** @type {any} */ (await sql`
		insert into nim_release_evals (model_id, owned_by, source)
		select x->>'id', x->>'owned_by', ${source}
		from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) as x
		on conflict (model_id) do nothing
		returning id, model_id
	`);
}

/**
 * Claim the oldest queued row (or one abandoned mid-run) and mark it running.
 * Safe under concurrent runs: `for update skip locked` hands each run a
 * different row.
 * @returns {Promise<any|null>}
 */
export async function claimNextReleaseEval() {
	const rows = await sql`
		update nim_release_evals
		set status = 'running', attempts = attempts + 1, started_at = now(), updated_at = now()
		where id = (
			select id from nim_release_evals
			where status = 'queued'
			   or (status = 'running' and started_at < now() - make_interval(mins => ${STALE_RUNNING_MINUTES}) and attempts < ${MAX_ATTEMPTS})
			order by created_at, id
			limit 1
			for update skip locked
		)
		returning *
	`;
	return rows[0] || null;
}

/**
 * Store a finished evaluation.
 * @param {number} id
 * @param {{ lane: string|null, classification: any, verdict: string, report: any, markdown: string, configDiff: string|null, postDraft: string|null }} result
 */
export async function completeReleaseEval(id, { lane, classification, verdict, report, markdown, configDiff, postDraft }) {
	const rows = await sql`
		update nim_release_evals
		set status = 'done', lane = ${lane}, classification = ${JSON.stringify(classification)}::jsonb,
		    verdict = ${verdict}, report = ${JSON.stringify(report)}::jsonb, report_md = ${markdown},
		    config_diff = ${configDiff}, post_draft = ${postDraft}, last_error = null,
		    completed_at = now(), updated_at = now()
		where id = ${id}
		returning *
	`;
	return rows[0] || null;
}

/**
 * Record a failed run. A transient failure goes back to the queue until
 * MAX_ATTEMPTS is reached; anything else is final.
 * @param {number} id
 * @param {{ error: string, transient: boolean, classification?: any }} opts
 */
export async function failReleaseEval(id, { error, transient, classification = null }) {
	const rows = await sql`
		update nim_release_evals
		set status = case when ${transient} and attempts < ${MAX_ATTEMPTS} then 'queued' else 'failed' end,
		    last_error = ${String(error).slice(0, 2000)},
		    classification = coalesce(${classification ? JSON.stringify(classification) : null}::jsonb, classification),
		    completed_at = case when ${transient} and attempts < ${MAX_ATTEMPTS} then null else now() end,
		    updated_at = now()
		where id = ${id}
		returning *
	`;
	return rows[0] || null;
}

/** Recent rows for the admin board, without the heavy report columns. */
export async function listReleaseEvals({ limit = 100 } = {}) {
	return sql`
		select id, model_id, owned_by, source, status, attempts, lane, verdict, last_error,
		       report->'candidate'->'quality' as candidate_quality,
		       report->'incumbent'->'quality' as incumbent_quality,
		       report->'candidate'->'latencyMs'->'p50' as candidate_p50,
		       report->'incumbent'->>'model' as incumbent_model,
		       config_diff is not null as has_diff, post_draft is not null as has_post,
		       created_at, started_at, completed_at
		from nim_release_evals
		order by created_at desc, id desc
		limit ${Math.min(Math.max(1, limit), 500)}
	`;
}

/**
 * One row in full, by numeric id or model id.
 * @param {{ id?: number|null, modelId?: string|null }} key
 */
export async function getReleaseEval({ id = null, modelId = null }) {
	const rows = id != null
		? await sql`select * from nim_release_evals where id = ${id}`
		: await sql`select * from nim_release_evals where model_id = ${modelId}`;
	return rows[0] || null;
}

/** Put a row back on the queue (admin action), resetting its attempt count. */
export async function requeueReleaseEval(id) {
	const rows = await sql`
		update nim_release_evals
		set status = 'queued', attempts = 0, last_error = null, started_at = null, completed_at = null,
		    source = 'manual', updated_at = now()
		where id = ${id} and status <> 'running'
		returning id, model_id, status
	`;
	return rows[0] || null;
}
