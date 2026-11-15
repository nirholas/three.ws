// The owner's yes for an X post, from the approval inbox.
//
// A post the queue's policy will not release (tier 1, a tag, never filmed)
// used to wait until someone at a laptop ran `npm run x:content -- approve`.
// Now `advance` asks the owner through the same inbox every other gated action
// uses (api/_lib/approvals.js): the request lands as a bell, a web push, the
// iOS app, a paired Telegram or Discord chat, or an email, and its page shows
// every post in the thread in full with its images, exactly as it will go out.
// One tap on Approve is the decision.
//
// The yes is bound to the review, not to the request: the request's payload
// names the review record's content hash, and the item is released only while
// that record still passes, is current, and matches the item byte for byte.
// Change one word after the owner approved it and the yes no longer applies.
//
// The executed approval row is itself the record. Nothing writes the queue
// from the inbox: the production tick and `advance` read the executed rows and
// treat a matching 'review' item as approved, so there is no second ledger to
// keep in step with the publish ledger.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approvalProblems, loadReview, REVIEW_MAX_AGE_DAYS } from './review.js';

import { X_ACCOUNT, X_POST_ACTION, mediaAt } from './owner-approval-view.js';

export { X_ACCOUNT, X_POST_ACTION, mediaAt, previewOf, xPostTable } from './owner-approval-view.js';
export const X_POST_SOURCE = 'x_post';
export const X_POST_VENUE = 'x_post';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const HEX64 = /^[0-9a-f]{64}$/;

const fileSha = (root, path) => {
	const absolute = resolve(root, String(path || ''));
	return path && existsSync(absolute) ? createHash('sha256').update(readFileSync(absolute)).digest('hex') : null;
};

const mediaType = (path) => (/\.(mp4|mov|webm)$/i.test(path) ? 'video' : /\.gif$/i.test(path) ? 'gif' : 'image');

// What the owner is asked to approve: every post's text and media as it will
// go out, and the review record it is bound to.
export function ownerApprovalPayload(item, record, root) {
	const media = (row) => ({ path: row.path, sha256: fileSha(root, row.path), alt: row.alt || null, type: mediaType(row.path) });
	return {
		item_id: item.id,
		content_hash: record.contentHash,
		reviewed_at: record.reviewedAt,
		kind: item.kind,
		tier: Number(item.tier) || null,
		poll: item.posts?.[0]?.poll ? { options: item.posts[0].poll.options, minutes: item.posts[0].poll.minutes } : null,
		article_title: item.kind === 'article' ? item.article?.title || null : null,
		posts: (item.posts || []).map((post) => ({ text: String(post.text || '').trim(), media: (post.media || []).map(media) })),
		not_before: item.notBefore || null,
	};
}

// The request is answerable for as long as the review it names stays current.
export function approvalTtlMs(record, now = Date.now()) {
	const ends = Date.parse(record.reviewedAt) + REVIEW_MAX_AGE_DAYS * DAY;
	return Math.max(HOUR, ends - now);
}

export function approvalSummary(item) {
	const head = (item.kind === 'article' ? item.article?.title : item.posts?.[0]?.text) || item.id;
	const flat = String(head).replace(/\s+/g, ' ').trim();
	return `Post to ${X_ACCOUNT}: ${flat.length > 90 ? `${flat.slice(0, 90)}...` : flat}`;
}

// Mark every 'review' item the owner approved, in place, while its review is
// the one they saw and still holds. Returns the ids it approved.
export function applyOwnerApprovals(items, approvals, root, now = Date.now()) {
	const yes = new Map();
	for (const row of approvals || []) if (row?.item_id && HEX64.test(row.content_hash || '')) {
		if (!yes.has(row.item_id)) yes.set(row.item_id, new Set());
		yes.get(row.item_id).add(row.content_hash);
	}
	const promoted = [];
	for (const item of items || []) {
		if (item.status !== 'review' || !yes.has(item.id)) continue;
		const record = loadReview(root, item.id);
		if (!record || !yes.get(item.id).has(record.contentHash)) continue;
		if (approvalProblems({ ...item, status: 'approved' }, root, now).length) continue;
		item.status = 'approved';
		item.approvedBy = 'owner';
		promoted.push(item.id);
	}
	return promoted;
}

// ── the inbox side ──────────────────────────────────────────────────────────────

// The executor the inbox runs on Approve. Publishing stays with the tick,
// which reads this row back; the executor only checks the payload names a
// reviewed item, so a malformed row is never recorded as a yes.
export async function executeApprovedXPost(row) {
	const p = row.payload || {};
	if (!p.item_id || !HEX64.test(p.content_hash || '')) return { status: 'error', note: 'The request does not name a reviewed post, so nothing was released.' };
	const when = p.not_before && Date.parse(p.not_before) > Date.now() ? ` from ${String(p.not_before).slice(0, 16).replace('T', ' ')} UTC` : '';
	return { status: 'ok', note: `Released: it goes out in priority order${when}.` };
}

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

// The bytes of the nth media entry of a request, exactly as reviewed: from the
// image when it shipped there, otherwise from the item's bundle, and only when
// the bytes hash to what the request names. Null when neither holds them.
export async function approvalMediaBytes(row, index, { root = process.cwd(), storage = null, env = process.env } = {}) {
	const entry = mediaAt(row, index);
	if (!entry || !HEX64.test(entry.sha256 || '')) return null;
	const contentType = CONTENT_TYPES[String(entry.path).split('.').pop().toLowerCase()] || 'application/octet-stream';
	const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
	const local = resolve(root, String(entry.path));
	if (local.startsWith(resolve(root, 'public')) && existsSync(local)) {
		const bytes = readFileSync(local);
		if (sha(bytes) === entry.sha256) return { bytes, contentType };
	}
	const { bundleStorage, fileKey } = await import('./overlay.js');
	try {
		const bytes = await (storage || bundleStorage(env)).get(fileKey(row.payload.item_id, entry.sha256));
		return bytes && sha(bytes) === entry.sha256 ? { bytes, contentType } : null;
	} catch {
		return null;
	}
}

// Every content hash the owner has said yes to in the window a review lasts.
export async function loadOwnerApprovals({ sql = null } = {}) {
	sql ||= (await import('../db.js')).sql;
	const rows = await sql`
		SELECT payload->>'item_id' AS item_id, payload->>'content_hash' AS content_hash
		FROM approval_requests
		WHERE source = ${X_POST_SOURCE} AND status = 'executed'
		  AND decided_at > now() - make_interval(days => ${REVIEW_MAX_AGE_DAYS + 1})
	`;
	return rows;
}

// Ask every admin to approve one reviewed item. A request for an older version
// of the item is closed first, so the inbox only ever holds the current copy.
export async function requestOwnerApproval(item, record, { root, now = Date.now(), userIds = null, sql = null, blockers = [] } = {}) {
	sql ||= (await import('../db.js')).sql;
	const { createApprovalRequest } = await import('../approvals.js');
	userIds ||= await (await import('../admin.js')).listAdminUserIds();
	const ref = `${item.id}:${record.contentHash.slice(0, 16)}`;
	const payload = ownerApprovalPayload(item, record, root);
	const out = [];
	for (const userId of userIds) {
		await sql`
			UPDATE approval_requests SET status = 'expired', updated_at = now()
			WHERE source = ${X_POST_SOURCE} AND user_id = ${userId} AND status = 'pending'
			  AND source_ref LIKE ${`${item.id}:%`} AND source_ref <> ${ref}
		`;
		const { request, created } = await createApprovalRequest({
			userId,
			requesterRole: 'x-content',
			source: X_POST_SOURCE,
			sourceRef: ref,
			actionType: X_POST_ACTION,
			venue: X_POST_VENUE,
			payload,
			summary: approvalSummary(item),
			// Not a chain: the columns are required, and the custom table above is
			// what every surface shows instead of a chain label.
			chain: 'x',
			network: X_ACCOUNT.slice(1),
			gateReason: blockers.length ? `The queue policy leaves this post to you: ${blockers.slice(0, 3).join('; ')}.` : 'The queue policy leaves this post to you.',
			idempotencyKey: `x_post:${userId}:${item.id}:${record.contentHash}`,
			ttlMs: approvalTtlMs(record, now),
			autoApprovable: false,
		});
		out.push({ userId, id: request.id, status: request.status, created });
	}
	return out;
}
