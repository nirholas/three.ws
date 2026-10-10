// Review queue actions for announcement drafts: edit, approve (one or a batch),
// reject. Approval is the only way a draft becomes sendable, and an edit sends a
// draft back to `draft` so the text that goes out is always the text approved.

import { sql } from '../db.js';
import { weightedLength } from '../x-content/quality.js';
import { lint } from './announce.js';

export class ReviewError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const MENTION = /(?<![\w@])@(\w{1,15})/g;

/** Problems that make a text unsendable. Mentions must come from the row's linked-handle tags. */
export function textProblems(text, tags) {
	const problems = [];
	if (!String(text || '').trim()) problems.push('text is empty');
	if (weightedLength(text) > 280) problems.push('text is longer than 280 characters');
	const allowed = new Set((tags || []).map((t) => t.toLowerCase()));
	for (const [, handle] of String(text).matchAll(MENTION)) {
		if (!allowed.has(handle.toLowerCase())) problems.push(`@${handle} is not a handle this entrant linked to their profile`);
	}
	for (const p of lint(text)) problems.push(p.message);
	return problems;
}

export async function listAnnouncements({ status = null, limit = 100 } = {}) {
	const q = status
		? sql`select a.*, m.slug, m.title from event_market_announcements a join event_markets m on m.id = a.market_id where a.status = ${status} order by a.created_at desc limit ${limit}`
		: sql`select a.*, m.slug, m.title from event_market_announcements a join event_markets m on m.id = a.market_id order by a.created_at desc limit ${limit}`;
	return q;
}

export async function editAnnouncement(id, text) {
	const [row] = await sql`select * from event_market_announcements where id = ${id}`;
	if (!row) throw new ReviewError('not_found', 'announcement not found', 404);
	if (['posting', 'posted'].includes(row.status)) throw new ReviewError('conflict', `a ${row.status} announcement cannot be edited`, 409);
	const problems = textProblems(text, row.tags);
	if (problems.length) throw new ReviewError('validation_error', problems.join('; '));
	const [out] = await sql`
		update event_market_announcements
		set draft_text = ${text}, status = 'draft', approved_by = null, approved_at = null, updated_at = now()
		where id = ${id} returning *
	`;
	return out;
}

/** Approve one or many drafts in a single action. Each is re-checked; failures are reported, not hidden. */
export async function approveAnnouncements(ids, approverId) {
	const approved = [];
	const failed = [];
	for (const id of ids) {
		const [row] = await sql`select * from event_market_announcements where id = ${id}`;
		if (!row) { failed.push({ id, reason: 'not found' }); continue; }
		if (row.status !== 'draft') { failed.push({ id, reason: `status is ${row.status}, only drafts can be approved` }); continue; }
		const problems = textProblems(row.draft_text, row.tags);
		if (problems.length) { failed.push({ id, reason: problems.join('; ') }); continue; }
		const [out] = await sql`
			update event_market_announcements
			set status = 'approved', approved_by = ${approverId}, approved_at = now(), updated_at = now()
			where id = ${id} and status = 'draft' returning *
		`;
		if (out) approved.push(out); else failed.push({ id, reason: 'changed while approving' });
	}
	return { approved, failed };
}

export async function rejectAnnouncement(id) {
	const [out] = await sql`
		update event_market_announcements set status = 'rejected', approved_by = null, approved_at = null, updated_at = now()
		where id = ${id} and status in ('draft','approved') returning *
	`;
	if (!out) throw new ReviewError('conflict', 'only a draft or approved announcement can be rejected', 409);
	return out;
}
