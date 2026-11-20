// Forge removal requests: the takedown queue for published 3D models (issue
// #639). Table: api/_lib/migrations/20261120120000_forge_removal_requests.sql.
//
// Owners delete their own models directly (DELETE /api/forge-creation with any
// owner credential). This queue is for the cases a credential cannot cover: a
// maker who lost every credential, a rights holder whose character or artwork
// someone else uploaded, a person whose likeness became a model. Anyone may
// file; only a platform admin acts. Removing runs the same full delete an owner
// gets (forgeStore.deleteCreation with the moderator grant), and the request row
// stays behind as the audit record.
//
// Request text is stored and shown to an admin. It is never executed, never
// fed to a model, and never treated as an instruction.

import { createHash } from 'node:crypto';

import { sql } from './db.js';
import { sendOpsAlert } from './alerts.js';
import { isUuid } from './validate.js';

export const REMOVAL_REASONS = ['my_content', 'copyright', 'likeness', 'harmful', 'other'];
export const REMOVAL_STATUSES = ['open', 'removed', 'dismissed'];

// Reasons that count toward auto-hiding a public model, and how many DISTINCT
// reporters it takes. Hidden means unlisted and held for an admin (never deleted
// and never private), so a coordinated pile-on can pull a model from the public
// gallery for review but cannot erase it. The same shape as the IRL pin reports
// (api/irl/report.js).
export const HIDE_REASONS = ['harmful', 'likeness'];
export const REPORT_HIDE_THRESHOLD = 3;

const REASON_TITLES = {
	my_content: 'I made it and want it removed',
	copyright: 'It copies my character, artwork or brand',
	likeness: 'It depicts me or someone I represent',
	harmful: 'It is harmful or breaks the rules',
	other: 'Something else',
};

export const DETAILS_MAX = 2000;
const CONTACT_MAX = 200;

export function reasonTitle(reason) {
	return REASON_TITLES[reason] || reason;
}

/** Salted one-way key for whoever filed, so duplicates fold without storing an IP or browser id. */
export function reporterKey(raw) {
	return createHash('sha256').update(`forge-removal:v1:${String(raw ?? '')}`).digest('hex').slice(0, 32);
}

function clean(value, max) {
	if (typeof value !== 'string') return null;
	const out = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
	return out ? out.slice(0, max) : null;
}

/**
 * Validate a public request body.
 * @returns {{ ok: true, creationId: string, reason: string, details: string|null, contact: string|null } | { ok: false, field: string, message: string }}
 */
export function normalizeRemovalRequest(body) {
	const b = body && typeof body === 'object' ? body : {};
	const creationId = typeof b.creation_id === 'string' ? b.creation_id.trim().toLowerCase() : '';
	if (!isUuid(creationId)) {
		return { ok: false, field: 'creation_id', message: 'Give the model id: the part after /m/ in the model page link.' };
	}
	if (!REMOVAL_REASONS.includes(b.reason)) {
		return { ok: false, field: 'reason', message: `reason must be one of: ${REMOVAL_REASONS.join(', ')}.` };
	}
	const details = clean(b.details, DETAILS_MAX);
	if (b.reason !== 'my_content' && (!details || details.length < 10)) {
		return { ok: false, field: 'details', message: 'Tell us in a sentence or two why this model should come down, so a reviewer can act on it.' };
	}
	const contact = clean(b.contact, CONTACT_MAX);
	if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
		return { ok: false, field: 'contact', message: 'Leave the contact field empty or give an email address we can reply to.' };
	}
	return { ok: true, creationId, reason: b.reason, details, contact };
}

/**
 * File a request. Resolves { request } for a new one, { duplicate: true } when
 * the same reporter already has an open request on this model, and
 * { notFound: true } when no such model exists (or it is already gone).
 */
export async function fileRemovalRequest({ creationId, reason, details = null, contact = null, reporterUserId = null, reporterKey: key, alert = sendOpsAlert }) {
	const [creation] = await sql`
		select id, prompt, visibility, glb_url from forge_creations where id = ${creationId} limit 1
	`;
	if (!creation) return { notFound: true };
	const [row] = await sql`
		insert into forge_removal_requests (creation_id, reason, details, contact, reporter_user_id, reporter_key)
		values (${creationId}, ${reason}, ${details}, ${contact}, ${reporterUserId}, ${key})
		on conflict (creation_id, reporter_key) where status = 'open' do nothing
		returning id, creation_id, reason, status, created_at
	`;
	if (!row) return { duplicate: true };
	const detail = [
		`Reason: ${reasonTitle(reason)}`,
		details ? `Details: ${details.slice(0, 500)}` : null,
		creation.prompt ? `Prompt: ${String(creation.prompt).slice(0, 200)}` : null,
		`Model: https://three.ws/m/${creationId}`,
		'Review: https://three.ws/admin/forge-removals',
	]
		.filter(Boolean)
		.join('\n');
	await alert('Forge removal request', detail, { signature: `forge_removal:${row.id}`, severity: 'warn' });
	const hidden = HIDE_REASONS.includes(reason) ? await hideIfReportedEnough(creationId, alert) : false;
	return { request: row, hidden };
}

async function hideIfReportedEnough(creationId, alert) {
	const counted = await sql`
		select count(distinct reporter_key)::int as n from forge_removal_requests
		where creation_id = ${creationId} and status = 'open' and reason = any(${HIDE_REASONS})
	`;
	if ((Number(counted[0]?.n) || 0) < REPORT_HIDE_THRESHOLD) return false;
	const hidden = await sql`
		update forge_creations
		set visibility = 'unlisted', safety_status = 'held', publish_requested_at = null,
			safety_checked_at = now(), updated_at = now()
		where id = ${creationId} and coalesce(visibility, 'public') = 'public'
			and safety_status is distinct from 'blocked'
		returning id
	`;
	if (!hidden.length) return false;
	await alert(
		'Forge model hidden by reports',
		`${REPORT_HIDE_THRESHOLD}+ distinct reporters flagged https://three.ws/m/${creationId}. It is unlisted and held for review at /api/admin/content-safety (approve) or /api/admin/forge-removals (remove).`,
		{ signature: `forge_removal:hidden:${creationId}`, severity: 'warn' },
	);
	return true;
}

/** Requests for the admin queue, newest first, with what is left of each model. */
export async function listRemovalRequests({ status = 'open', limit = 50 } = {}) {
	const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const rows =
		status === 'all'
			? await sql`
				select r.*, c.prompt, c.preview_image_url, c.glb_url, c.visibility, c.status as creation_status,
					c.created_at as creation_created_at, (c.id is not null) as creation_exists
				from forge_removal_requests r
				left join forge_creations c on c.id = r.creation_id
				order by r.created_at desc limit ${n}
			`
			: await sql`
				select r.*, c.prompt, c.preview_image_url, c.glb_url, c.visibility, c.status as creation_status,
					c.created_at as creation_created_at, (c.id is not null) as creation_exists
				from forge_removal_requests r
				left join forge_creations c on c.id = r.creation_id
				where r.status = ${status}
				order by r.created_at desc limit ${n}
			`;
	return rows.map(({ reporter_key: _k, ...rest }) => rest);
}

/** Open-request counts for the queue header. */
export async function removalRequestCounts() {
	const rows = await sql`select status, count(*)::int as n from forge_removal_requests group by status`;
	const out = { open: 0, removed: 0, dismissed: 0 };
	for (const r of rows) out[r.status] = r.n;
	return out;
}

/**
 * Close every open request on a creation that was just taken down, and record
 * the takedown itself when nobody filed one through the form (a GitHub issue,
 * an email). Returns the ids it closed or created.
 */
export async function recordTakedown({ creationId, reason = 'other', details = null, resolution, reviewedBy }) {
	const closed = await sql`
		update forge_removal_requests
		set status = 'removed', resolution = ${resolution}, reviewed_by = ${reviewedBy}, reviewed_at = now()
		where creation_id = ${creationId} and status = 'open'
		returning id
	`;
	if (closed.length) return closed.map((r) => r.id);
	const [row] = await sql`
		insert into forge_removal_requests
			(creation_id, reason, details, reporter_key, status, resolution, reviewed_by, reviewed_at)
		values (${creationId}, ${REMOVAL_REASONS.includes(reason) ? reason : 'other'}, ${clean(details, DETAILS_MAX)},
			${reporterKey(`ops:${reviewedBy}`)}, 'removed', ${resolution}, ${reviewedBy}, now())
		returning id
	`;
	return row ? [row.id] : [];
}

/**
 * Act on a request. 'remove' deletes the model (moderator grant) and closes
 * every open request on it; a model that is already gone still closes as
 * removed. 'dismiss' closes only this request.
 * Resolves { request, outcome } or null when no such request exists.
 * `outcome` is the deleteCreation result for 'remove', 'dismissed' otherwise.
 */
export async function resolveRemovalRequest({ id, action, resolution, reviewedBy, deleteCreation }) {
	const [req] = await sql`select id, creation_id, status from forge_removal_requests where id = ${id} limit 1`;
	if (!req) return null;
	if (action === 'dismiss') {
		const [row] = await sql`
			update forge_removal_requests
			set status = 'dismissed', resolution = ${resolution}, reviewed_by = ${reviewedBy}, reviewed_at = now()
			where id = ${id}
			returning *
		`;
		return { request: row, outcome: 'dismissed' };
	}
	const outcome = await deleteCreation({ id: req.creation_id, moderator: true });
	if (outcome !== 'deleted' && outcome !== 'not_found') return { request: req, outcome };
	await sql`
		update forge_removal_requests
		set status = 'removed', resolution = ${resolution}, reviewed_by = ${reviewedBy}, reviewed_at = now()
		where creation_id = ${req.creation_id} and (status = 'open' or id = ${id})
	`;
	const [row] = await sql`select * from forge_removal_requests where id = ${id} limit 1`;
	return { request: row, outcome };
}
