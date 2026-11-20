// Persistence and policy for the public-listing safety screen. What is judged,
// and how verdicts combine, is content-safety.js. This file owns what happens
// to a model because of the verdict.
//
//   gatePublish        the check setCreationVisibility runs when a maker asks for
//                      'public'. Allows only a model whose safety_status is clear.
//   screenAndRecord    run the screen, write the audit row, move the model to the
//                      state the verdict dictates. Used by the gate and the sweep.
//   adminDecision      an admin approving a held/blocked model or marking it removed.
//
// States (forge_creations.safety_status, see the migration for the full table):
//   blocked forces visibility 'private' and publish_requested_at null, and the
//   maker can no longer publish it. held waits for an admin. Neither deletes
//   anything: a flagged model is evidence, and a CSAM verdict in particular must
//   be preserved for the legal report the owner files (docs/ops/content-safety.md).

import { sql, isDbUnavailableError } from './db.js';
import { screenCreation } from './content-safety.js';
import { sendOpsAlert } from './alerts.js';

/** An undecided publish is retried by the sweep; after this it waits for a human. */
export const HOLD_AFTER_MS = 6 * 60 * 60 * 1000;
/** A request that just came back undecided is not re-screened inside this window. */
export const RESCREEN_COOLDOWN_MS = 60 * 1000;

function toReviewVerdict(verdict) {
	return verdict === 'clear' || verdict === 'blocked' ? verdict : 'undecided';
}

async function insertReview({ id, result, reviewer = 'auto', note = null }) {
	await sql`
		insert into content_safety_reviews (subject_id, verdict, categories, csam, signals, models, reviewer, note)
		values (${id}, ${toReviewVerdict(result.verdict)}, ${result.categories || []}, ${result.csam === true},
			${JSON.stringify(result.signals ?? null)}, ${result.models || []}, ${reviewer}, ${note})
	`;
}

async function alertBlocked(row, result) {
	const csam = result.csam === true;
	await sendOpsAlert(
		csam ? '🚨 CSAM screen hit on a public Forge model' : '⚠️ Content screen blocked a Forge model',
		[
			`creation ${row.id}`,
			`categories: ${(result.categories || []).join(', ') || 'unspecified'}`,
			csam
				? 'Forced private and PRESERVED. Do not delete. Follow docs/ops/content-safety.md (legal report, then removal).'
				: 'Forced private. Review at /api/admin/content-safety (approve or remove).',
		].join('\n'),
		{ signature: `content-safety:${csam ? 'csam' : 'blocked'}:${row.id}`, severity: csam ? 'critical' : 'warn' },
	);
}

/**
 * Screen a creation and move it to the state the verdict dictates.
 * Never throws; returns { verdict: 'clear' | 'blocked' | 'undecided', ... }.
 * @param {{ id: string, prompt?: string | null, preview_image_url?: string | null, source_image_urls?: string[] | null }} row
 * @param {{ screen?: typeof screenCreation, requested?: boolean }} [opts]
 */
export async function screenAndRecord(row, { screen = screenCreation, requested = false } = {}) {
	let result;
	try {
		result = await screen({ prompt: row.prompt, previewImageUrl: row.preview_image_url, sourceImageUrls: row.source_image_urls });
	} catch (err) {
		result = { verdict: 'undecided', categories: [], csam: false, reasons: [String(err?.message || err)], models: [], signals: null };
	}
	try {
		await insertReview({ id: row.id, result });
		if (result.verdict === 'clear') {
			await sql`
				update forge_creations set safety_status = 'clear', safety_checked_at = now()
				where id = ${row.id} and safety_status is distinct from 'blocked'
			`;
		} else if (result.verdict === 'blocked') {
			await sql`
				update forge_creations
				set safety_status = 'blocked', safety_checked_at = now(), visibility = 'private',
					publish_requested_at = null, updated_at = now()
				where id = ${row.id}
			`;
			await alertBlocked(row, result);
		} else {
			await sql`
				update forge_creations
				set safety_status = coalesce(safety_status, case when ${requested} then 'pending' end),
					safety_checked_at = now()
				where id = ${row.id}
			`;
		}
	} catch (err) {
		if (!isDbUnavailableError(err)) console.error('[content-safety] recording verdict failed:', err?.message);
		return { ...result, verdict: 'undecided', recordError: true };
	}
	return result;
}

/**
 * The gate for "make this model public". Call only after ownership is proven.
 * @returns {Promise<{ allow: true } | { allow: false, outcome: 'blocked' | 'pending' | 'error' }>}
 */
export async function gatePublish(id, { screen = screenCreation } = {}) {
	let row;
	try {
		[row] = await sql`
			select id, prompt, preview_image_url, source_image_urls, safety_status, safety_checked_at
			from forge_creations where id = ${id} and status = 'done'
		`;
	} catch (err) {
		if (!isDbUnavailableError(err)) console.error('[content-safety] gate lookup failed:', err?.message);
		return { allow: false, outcome: 'error' };
	}
	if (!row) return { allow: false, outcome: 'error' };
	if (row.safety_status === 'clear') return { allow: true };
	if (row.safety_status === 'blocked') return { allow: false, outcome: 'blocked' };

	const requestPending = async () => {
		await sql`
			update forge_creations
			set publish_requested_at = coalesce(publish_requested_at, now()),
				safety_status = coalesce(safety_status, 'pending')
			where id = ${id} and safety_status is distinct from 'blocked'
		`;
		return { allow: false, outcome: 'pending' };
	};

	try {
		if (row.safety_status === 'held') return await requestPending();
		const recentlyTried =
			row.safety_status === 'pending' &&
			row.safety_checked_at &&
			Date.now() - new Date(row.safety_checked_at).getTime() < RESCREEN_COOLDOWN_MS;
		if (recentlyTried) return await requestPending();

		const result = await screenAndRecord(row, { screen, requested: true });
		if (result.verdict === 'clear') return { allow: true };
		if (result.verdict === 'blocked') return { allow: false, outcome: 'blocked' };
		return await requestPending();
	} catch (err) {
		if (!isDbUnavailableError(err)) console.error('[content-safety] gate failed:', err?.message);
		return { allow: false, outcome: 'error' };
	}
}

/** Rows the admin queue shows: everything the screen stopped, newest first. */
export async function listAttention({ status = 'attention', limit = 50 } = {}) {
	const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const statuses = status === 'all' ? ['held', 'blocked'] : status === 'attention' ? ['held', 'blocked'] : [status];
	const rows = await sql`
		select fc.id, fc.prompt, fc.preview_image_url, fc.visibility, fc.safety_status, fc.safety_checked_at,
			fc.publish_requested_at, fc.created_at,
			(select json_build_object('categories', r.categories, 'csam', r.csam, 'verdict', r.verdict, 'at', r.created_at)
				from content_safety_reviews r where r.subject_id = fc.id order by r.created_at desc limit 1) as last_review
		from forge_creations fc
		where fc.safety_status = any(${statuses})
		order by fc.safety_checked_at desc nulls last
		limit ${cap}
	`;
	return rows;
}

export async function safetyCounts() {
	const rows = await sql`
		select coalesce(safety_status, 'unscreened') as status, count(*)::int as n
		from forge_creations where status = 'done' and coalesce(internal, false) = false
		group by 1
	`;
	return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/**
 * An admin overriding the screen. 'approve' marks the model clear so the sweep
 * (or the maker) can publish it; it records who and why. Removal is the caller's
 * job (deleteCreation with the moderator grant); this only audits the decision.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'not_found' }>}
 */
export async function adminDecision({ id, action, note, actor }) {
	const [row] = await sql`select id, safety_status from forge_creations where id = ${id}`;
	if (!row && action === 'approve') return { ok: false, reason: 'not_found' };
	const result = { verdict: action === 'approve' ? 'clear' : 'blocked', categories: [], csam: false, signals: null, models: [] };
	await insertReview({ id, result, reviewer: `admin:${actor || 'unknown'}`, note });
	if (action === 'approve') {
		await sql`
			update forge_creations set safety_status = 'clear', safety_checked_at = now(), updated_at = now()
			where id = ${id}
		`;
	}
	return { ok: true };
}
