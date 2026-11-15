import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentHash, reviewPath } from '../api/_lib/x-content/review.js';
import { applyOwnerApprovals, approvalTtlMs, executeApprovedXPost, ownerApprovalPayload, previewOf, xPostTable } from '../api/_lib/x-content/owner-approval.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
let root;

const item = (id, extra = {}) => ({ id, kind: 'thread', status: 'review', tier: 2, notBefore: '2026-11-16T00:00:00Z', posts: [{ text: `The ${id} post.`, media: [{ path: `public/x-media/${id}/a.png`, alt: `${id} screen` }] }, { text: 'Second part.' }], claims: [], ...extra });

function review(entry, overrides = {}) {
	const record = { id: entry.id, contentHash: contentHash(entry, root), reviewedAt: new Date(NOW - 86_400_000).toISOString(), passed: true, blockers: [], ...overrides };
	writeFileSync(join(root, reviewPath(entry.id)), JSON.stringify(record));
	return record;
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'x-owner-'));
	mkdirSync(join(root, 'data/x-content/reviews'), { recursive: true });
	for (const id of ['a', 'b', 'c', 'd']) {
		mkdirSync(join(root, `public/x-media/${id}`), { recursive: true });
		writeFileSync(join(root, `public/x-media/${id}/a.png`), `png-${id}`);
	}
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('owner approval payload', () => {
	it('carries the exact copy, the media bytes, and the review it is bound to', () => {
		const entry = item('a');
		const record = review(entry);
		const payload = ownerApprovalPayload(entry, record, root);
		expect(payload.item_id).toBe('a');
		expect(payload.content_hash).toBe(record.contentHash);
		expect(payload.posts.map((post) => post.text)).toEqual(['The a post.', 'Second part.']);
		expect(payload.posts[0].media[0]).toMatchObject({ path: 'public/x-media/a/a.png', alt: 'a screen' });
		expect(payload.posts[0].media[0].sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(payload.not_before).toBe('2026-11-16T00:00:00Z');
	});

	it('shows a poll for as long as it will actually run', () => {
		const entry = { id: 'p', kind: 'post', status: 'review', tier: 3, posts: [{ text: 'Which one?', poll: { options: ['Rig', 'Pose'], durationMinutes: 4320 } }], claims: [] };
		const row = { action_type: 'x_post_publish', payload: ownerApprovalPayload(entry, { contentHash: 'f'.repeat(64), reviewedAt: new Date(NOW).toISOString() }, root) };
		expect(row.payload.poll).toEqual({ options: ['Rig', 'Pose'], durationMinutes: 4320 });
		expect(xPostTable(row).find((r) => r.key === 'poll').value).toBe('Rig / Pose (72 h)');
		row.payload.poll.durationMinutes = 5;
		expect(xPostTable(row).find((r) => r.key === 'poll').value).toBe('Rig / Pose (5 min)');
	});

	it('expires when the review does, and never in under an hour', () => {
		expect(approvalTtlMs({ reviewedAt: new Date(NOW - 86_400_000).toISOString() }, NOW)).toBe(13 * 86_400_000);
		expect(approvalTtlMs({ reviewedAt: new Date(NOW - 20 * 86_400_000).toISOString() }, NOW)).toBe(3_600_000);
	});

	it('renders a table that shows every post in full', () => {
		const entry = item('a');
		const row = { action_type: 'x_post_publish', payload: ownerApprovalPayload(entry, review(entry), root) };
		const table = xPostTable(row);
		expect(table.find((r) => r.key === 'post').value).toBe('The a post.');
		expect(table.find((r) => r.key === 'reply-1').value).toBe('Second part.');
		expect(table.find((r) => r.key === 'media').value).toMatch(/1 image/);
		expect(table.find((r) => r.key === 'account').value).toBe('@trythreews');
		expect(previewOf(row).posts[0].media[0]).toEqual({ index: 0, alt: 'a screen', type: 'image' });
	});
});

describe('applying owner approvals', () => {
	it('approves a review item the owner said yes to, only while the copy is the one they saw', () => {
		const yes = item('b');
		const changed = item('c');
		const unasked = item('d');
		const items = [yes, changed, unasked].map((entry) => ({ ...entry }));
		const approvals = [ownerApprovalPayload(yes, review(yes), root), ownerApprovalPayload(changed, review(changed), root)];
		// The owner approved c, then someone edited it and it was reviewed again.
		items[1].posts = [{ text: 'Different words now.' }];
		review(items[1]);
		review(unasked);
		const promoted = applyOwnerApprovals(items, approvals, root, NOW);
		expect(promoted).toEqual(['b']);
		expect(items[0]).toMatchObject({ status: 'approved', approvedBy: 'owner' });
		expect(items[1].status).toBe('review');
		expect(items[2].status).toBe('review');
	});

	it('does not approve an item whose review went stale after the yes', () => {
		const entry = item('a');
		const record = review(entry, { reviewedAt: new Date(NOW - 15 * 86_400_000).toISOString() });
		const items = [{ ...entry }];
		expect(applyOwnerApprovals(items, [ownerApprovalPayload(entry, record, root)], root, NOW)).toEqual([]);
	});

	it('leaves posted and draft items alone', () => {
		const entry = item('a', { status: 'posted' });
		const record = review(entry);
		expect(applyOwnerApprovals([entry], [ownerApprovalPayload(entry, record, root)], root, NOW)).toEqual([]);
		expect(entry.status).toBe('posted');
	});
});

describe('the executor', () => {
	it('records the yes and refuses a payload that does not name a reviewed item', async () => {
		expect((await executeApprovedXPost({ payload: { item_id: 'a', content_hash: 'f'.repeat(64), not_before: '2026-11-16T00:00:00Z' } })).status).toBe('ok');
		expect((await executeApprovedXPost({ payload: { item_id: 'a' } })).status).toBe('error');
	});
});

describe('the approval inbox', () => {
	it('renders an X post request as the post, never as a transfer, and never auto-approves it', async () => {
		const { confirmationTable, publicApproval, VENUES, hasExecutor } = await import('../api/_lib/approvals.js');
		const entry = item('a');
		const row = { id: '00000000-0000-4000-8000-000000000000', user_id: 'u', action_type: 'x_post_publish', venue: 'x_post', source: 'x_post', status: 'executed', payload: ownerApprovalPayload(entry, review(entry), root), payload_hash: 'h', expires_at: new Date(NOW + 3_600_000).toISOString() };
		expect(confirmationTable(row).map((r) => r.key)).not.toContain('recipient');
		expect(publicApproval(row).preview.posts[0].text).toBe('The a post.');
		expect(VENUES.x_post.auto).toBe(false);
		expect(hasExecutor('x_post')).toBe(true);
	});
});

describe('preview media', () => {
	it('serves the reviewed bytes from the image or the bundle, and nothing that does not hash to the request', async () => {
		const { approvalMediaBytes } = await import('../api/_lib/x-content/owner-approval.js');
		const entry = item('a');
		const row = { payload: ownerApprovalPayload(entry, review(entry), root) };
		expect((await approvalMediaBytes(row, 0, { root })).bytes.toString()).toBe('png-a');
		expect(await approvalMediaBytes(row, 1, { root })).toBeNull();
		// Bytes changed on disk after the request: the image copy is refused and
		// the bundle copy, which still matches, is served instead.
		writeFileSync(join(root, 'public/x-media/a/a.png'), 'edited');
		const bundled = new Map([[`x-content/bundles/a/${row.payload.posts[0].media[0].sha256}`, Buffer.from('png-a')]]);
		const storage = { get: async (key) => bundled.get(key) || null };
		expect((await approvalMediaBytes(row, 0, { root, storage })).contentType).toBe('image/png');
		expect(await approvalMediaBytes(row, 0, { root, storage: { get: async () => Buffer.from('other') } })).toBeNull();
		writeFileSync(join(root, 'public/x-media/a/a.png'), 'png-a');
	});
});

describe('the tick', () => {
	it('publishes a review item only once the owner approved the copy on record', async () => {
		const { runTick } = await import('../api/_lib/x-content/runner.js');
		const { memoryStore } = await import('../api/_lib/x-content/state.js');
		const dir = mkdtempSync(join(tmpdir(), 'x-owner-tick-'));
		mkdirSync(join(dir, 'data/x-content/reviews'), { recursive: true });
		const post = { id: 'owner-post', kind: 'post', status: 'review', tier: 2, lane: 'creation', pattern: 'demo', textOnly: true, notBefore: '2026-11-01T00:00:00Z', posts: [{ text: 'Rig any humanoid GLB in the browser, then pose it, retarget a walk cycle onto it, and export it again. https://three.ws/rig' }], claims: [] };
		writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ account: 'trythreews', cadence: { slots: [{ tier: 2, at: '11:00' }] }, items: [post] }));
		const record = { id: post.id, contentHash: contentHash(post, dir), reviewedAt: new Date(NOW - 3_600_000).toISOString(), passed: true, blockers: [] };
		writeFileSync(join(dir, reviewPath(post.id)), JSON.stringify(record));
		const tick = (ownerApprovals) => runTick({ root: dir, store: memoryStore(), dryRun: true, now: NOW, env: {}, outcomes: null, ownerApprovals });
		expect((await tick(async () => [])).preview).toBeUndefined();
		expect((await tick(async () => [{ item_id: post.id, content_hash: 'a'.repeat(64) }])).preview).toBeUndefined();
		const released = await tick(async () => [{ item_id: post.id, content_hash: record.contentHash }]);
		expect(released.preview?.id).toBe(post.id);
		expect(released.ownerApproved).toEqual([post.id]);
		// The inbox being down never stops the tick; it just releases nothing new.
		expect((await tick(async () => { throw new Error('db down'); })).preview).toBeUndefined();
	});
});
