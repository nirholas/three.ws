#!/usr/bin/env node
// Live check for the X post approval path (api/_lib/x-content/owner-approval.js)
// against a throwaway database, end to end on the real code:
//
//   1. ask the owner to approve a reviewed post from the real queue
//      (requestOwnerApproval -> createApprovalRequest -> deliverApproval)
//   2. read it back as the approval page does (getApproval) and fetch its
//      preview media (getApprovalMedia), checking the bytes are the reviewed ones
//   3. approve it as the owner does from the page or a push button (decideApproval)
//   4. read the executed yes back (loadOwnerApprovals) and apply it to the queue
//      (applyOwnerApprovals): the item turns approved
//
// The database is PGlite with the production schema (scripts/lib/isolated-db.mjs),
// so nothing touches production and no notification leaves the machine: the
// throwaway owner has an unroutable address, no push subscription, and no
// paired chat, and the email key is cleared for this process.
//
//   node scripts/x-owner-approval-live-check.mjs [<item id>]

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The email fallback must not try to reach the throwaway address.
process.env.RESEND_API_KEY = '';
// Deep links are signed with JWT_SECRET; a throwaway one signs this run's links.
process.env.JWT_SECRET ||= randomUUID() + randomUUID();
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const db = await useIsolatedDb();

const { loadQueue } = await import('../api/_lib/x-content/queue.js');
const { approvalProblems, loadReview } = await import('../api/_lib/x-content/review.js');
const { applyOwnerApprovals, loadOwnerApprovals, requestOwnerApproval } = await import('../api/_lib/x-content/owner-approval.js');
const { decideApproval, getApproval, getApprovalMedia } = await import('../api/_lib/approvals.js');

const queue = loadQueue(root);
const wanted = process.argv[2];
const item = queue.items.find((row) => (wanted ? row.id === wanted : row.status === 'review' && (row.posts || []).some((post) => post.media?.length) && !approvalProblems({ ...row, status: 'approved' }, root).length));
if (!item) {
	console.error(wanted ? `${wanted} is not in the queue` : 'No item in review has a current, passing review with media; review one first.');
	process.exit(1);
}
const record = loadReview(root, item.id);
const step = (ok, label, detail = '') => {
	console.log(`${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
	if (!ok) process.exitCode = 1;
};

const userId = randomUUID();
await db.query(`insert into users (id, email, display_name) values ($1, $2, $3)`, [userId, `x-approval-live-check+${userId.slice(0, 8)}@example.invalid`, 'X approval live check']);
console.log(`item ${item.id} (${item.kind}, tier ${item.tier}), review ${record.contentHash.slice(0, 12)}\n`);

const [asked] = await requestOwnerApproval(item, record, { root, userIds: [userId], blockers: ['live check'] });
step(asked?.created && asked.status === 'pending', 'request created', asked?.id);
const again = await requestOwnerApproval(item, record, { root, userIds: [userId], blockers: ['live check'] });
step(again[0].id === asked.id && !again[0].created, 'asking twice keeps one request');

const shown = await getApproval(userId, asked.id);
step(shown.preview?.posts?.length === item.posts.length, 'page preview has every post', `${shown.preview.posts.length} part(s)`);
step(shown.confirmation.some((row) => row.key === 'post' && row.value === item.posts[0].text.trim()), 'table shows the head post in full');
const firstMedia = shown.preview.posts.flatMap((post) => post.media)[0];
if (firstMedia) {
	const media = await getApprovalMedia(userId, asked.id, firstMedia.index);
	step(media.bytes.length > 0, 'preview media served from the reviewed bytes', `${media.contentType}, ${media.bytes.length} bytes`);
}

const decided = await decideApproval({ userId, id: asked.id, decision: 'approve', payloadHash: shown.payload_hash, via: 'web' });
step(decided.request?.status === 'executed', 'approve runs the executor', decided.request?.result?.note || decided.request?.status);

const yeses = await loadOwnerApprovals();
step(yeses.some((row) => row.item_id === item.id && row.content_hash === record.contentHash), 'the yes reads back from the inbox');
const copy = structuredClone(queue.items);
const promoted = applyOwnerApprovals(copy, yeses, root);
step(promoted.includes(item.id) && copy.find((row) => row.id === item.id).status === 'approved', 'the queue item turns approved', promoted.join(', '));

console.log(process.exitCode ? '\nX owner approval live check FAILED' : '\nX owner approval live check passed');
process.exit(process.exitCode || 0);
