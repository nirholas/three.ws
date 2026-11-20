// The Forge judge comparison board: read and label forge_judge_shadow rows.
//
// Rows are written by api/_lib/forge-judge-shadow.js (the live gate) and
// scripts/cosmos-judge-eval.mjs (the eval). An operator reads them and labels
// disagreements with `npm run forge:judge` (scripts/forge-judge.mjs). There is
// deliberately no admin page or admin HTTP endpoint for this: the public server
// exposes nothing that reads the views or writes labels. Rows carry structured
// verdicts only; no reasoning trace is ever stored, so none can be returned.

import { sql } from './db.js';
import { getObjectBuffer } from './r2.js';

export const JUDGE_VIEWS = ['disagree', 'cosmos_reject', 'unlabelled', 'all'];
export const JUDGE_SOURCES = ['forge', 'eval', 'all'];
export const JUDGE_LABELS = ['accepted', 'rejected'];

// Only keys recordJudgeShadow writes (forge/judge-shadow/<source>/<date>/<id>/<view>.png).
const RENDER_KEY = /^forge\/judge-shadow\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_-]+\.png$/;
export const isJudgeRenderKey = (key) =>
	typeof key === 'string' && RENDER_KEY.test(key) && !key.split('/').some((seg) => seg === '.' || seg === '..');

/**
 * Shadow rows, newest first. `view` picks disagreements, Cosmos rejections,
 * unlabelled disagreements or everything; `before` pages by row id.
 * @returns {Promise<{ rows: object[], nextBefore: string|null }>}
 */
export async function listJudgeRows({ view = 'disagree', source = 'all', issue = null, limit = 40, before = null } = {}) {
	const cap = Math.min(Math.max(Number(limit) || 40, 1), 100);
	const src = source === 'all' ? null : source;
	const cursor = before != null && /^\d+$/.test(String(before)) ? String(before) : null;
	const rows = await sql`
		select id, created_at, source, creation_id, glb_url, prompt, subject, render_keys,
		       current, cosmos, current_pass, cosmos_pass, disagree, mode, applied,
		       human_label, labelled_by, labelled_at
		from forge_judge_shadow
		where (${src}::text is null or source = ${src})
		  and (${cursor}::bigint is null or id < ${cursor})
		  and (${issue}::text is null or cosmos->'issues' ? ${issue})
		  and case ${view}
		        when 'disagree' then disagree
		        when 'cosmos_reject' then cosmos_pass = false
		        when 'unlabelled' then human_label is null and disagree
		        else true end
		order by id desc
		limit ${cap + 1}`;
	const page = rows.slice(0, cap);
	return { rows: page, nextBefore: rows.length > cap ? String(page[page.length - 1].id) : null };
}

/** Running totals: rows, disagreements, and each judge's agreement with the human label. */
export async function judgeTotals(source = 'all') {
	const src = source === 'all' ? null : source;
	const [t] = await sql`
		select count(*)::int as rows,
		       count(*) filter (where disagree)::int as disagree,
		       count(*) filter (where current_pass is not null and cosmos_pass is not null)::int as both_answered,
		       count(*) filter (where human_label is not null)::int as labelled,
		       count(*) filter (where human_label is not null and current_pass is not null
		                         and current_pass = (human_label = 'accepted'))::int as current_agrees,
		       count(*) filter (where human_label is not null and current_pass is not null)::int as current_labelled,
		       count(*) filter (where human_label is not null and cosmos_pass is not null
		                         and cosmos_pass = (human_label = 'accepted'))::int as cosmos_agrees,
		       count(*) filter (where human_label is not null and cosmos_pass is not null)::int as cosmos_labelled,
		       count(*) filter (where applied = 'cosmos')::int as cosmos_decided
		from forge_judge_shadow
		where (${src}::text is null or source = ${src})`;
	return t;
}

/**
 * Record (label 'accepted' | 'rejected') or clear (label null) an operator's
 * label on one row. Returns the updated row, or null when no row has that id.
 */
export async function labelJudgeRow({ id, label, actor }) {
	if (!/^\d+$/.test(String(id ?? ''))) throw new TypeError('id must be a shadow row id');
	if (label !== null && !JUDGE_LABELS.includes(label)) throw new TypeError(`label must be one of ${JUDGE_LABELS.join(', ')} or null`);
	const who = String(actor || 'ops').slice(0, 120);
	const rows = await sql`
		update forge_judge_shadow
		set human_label = ${label},
		    labelled_by = ${label ? `admin:${who}` : null},
		    labelled_at = ${label ? new Date().toISOString() : null}
		where id = ${String(id)}
		returning id, human_label, labelled_by, labelled_at`;
	return rows[0] ?? null;
}

/**
 * The PNG bytes of one judging view. getObjectBuffer reads R2 and falls back to
 * the GCS bucket, where a view written during an R2 outage lives. Refuses any
 * key the shadow recorder could not have written.
 */
export async function readJudgeView(key) {
	if (!isJudgeRenderKey(key)) throw new TypeError(`not a judge view key: ${key}`);
	return getObjectBuffer(key);
}
