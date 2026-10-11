// The approval inbox, against the REAL approval_requests migration in an
// in-process Postgres (PGlite). Pins the contracts the inbox exists for:
//   - an approval executes exactly the action that was shown, once: a stale or
//     tampered payload hash is refused, and a row edited after it was shown
//     fails the executor's integrity check without running anything;
//   - an expired request can never execute, even with the right hash;
//   - a double approve (push tap racing a web click) runs the executor once;
//   - deny and bulk deny are terminal and fail closed;
//   - signed deep links verify against the request on file;
//   - auto-approve rules are explicit, capped by size and venue, revocable, and
//     never cover a transfer to a never-paid address.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/audit.js', () => audit);

const notify = vi.hoisted(() => ({
	insertNotification: vi.fn(async () => ({ id: 1, in_app: true, delivered: { push: 1 } })),
	emailAllowedForType: vi.fn(async () => true),
}));
vi.mock('../api/_lib/notify.js', () => notify);

const email = vi.hoisted(() => ({ sendApprovalRequestEmail: vi.fn(async () => ({ id: 'email-1' })) }));
vi.mock('../api/_lib/email.js', () => email);

const executor = vi.hoisted(() => ({ executeApprovedIntentAction: vi.fn(async () => ({ status: 'ok', signature: 'SIGtest1111', usd: 12 })) }));
vi.mock('../api/_lib/wallet-intents.js', () => executor);

const A = await import('../api/_lib/approvals.js');

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261010120000_approval_requests.sql', import.meta.url), 'utf8');

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const RECIPIENT = 'THREEsynthetic1111111111111111111111111111';

let seq = 0;
function request(overrides = {}) {
	seq += 1;
	return {
		userId: OWNER,
		agentId: AGENT,
		source: 'wallet_intent',
		sourceRef: `intent-${seq}:${RECIPIENT}`,
		actionType: 'transfer_sol',
		venue: 'wallet_transfer',
		payload: { v: 1, source: 'wallet_intent', intent_id: `intent-${seq}`, lamports: '250000000', destination: RECIPIENT },
		summary: 'Send 0.25 SOL to a saved address',
		amount: 0.25,
		amountUsd: 40,
		asset: 'SOL',
		recipient: RECIPIENT,
		riskNotes: ['Your rule "Ask me above $25" asked for approval.'],
		gateReason: 'Ask me above $25',
		idempotencyKey: `wallet_intent:intent-${seq}:bucket`,
		...overrides,
	};
}

beforeAll(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(`
		create table users (id uuid primary key, email text);
		create table agent_identities (id uuid primary key, user_id uuid, name text, deleted_at timestamptz);
		insert into users (id, email) values ('${OWNER}', 'owner@example.com'), ('${STRANGER}', 'other@example.com');
		insert into agent_identities (id, user_id, name) values ('${AGENT}', '${OWNER}', 'Scout');
	`);
	await dbState.pg.exec(MIGRATION);
});

beforeEach(async () => {
	await dbState.pg.exec('delete from approval_requests; delete from approval_auto_policies;');
	vi.clearAllMocks();
	notify.insertNotification.mockResolvedValue({ id: 1, in_app: true, delivered: { push: 1 } });
	executor.executeApprovedIntentAction.mockResolvedValue({ status: 'ok', signature: 'SIGtest1111', usd: 12 });
});

describe('payload hash', () => {
	it('is stable across key order and changes with any field', () => {
		const a = A.payloadHash({ b: 1, a: { y: 2, x: '3' } });
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(A.payloadHash({ a: { x: '3', y: 2 }, b: 1 })).toBe(a);
		expect(A.payloadHash({ a: { x: '3', y: 2 }, b: 2 })).not.toBe(a);
	});
});

describe('createApprovalRequest', () => {
	it('stores a pending request with the confirmation table and delivers it', async () => {
		const { request: row, created, autoApproved } = await A.createApprovalRequest(request());
		expect(created).toBe(true);
		expect(autoApproved).toBe(false);
		expect(row.status).toBe('pending');
		expect(row.payload_hash).toBe(A.payloadHash(row.payload));
		expect(notify.insertNotification).toHaveBeenCalledWith(OWNER, 'approval_requested', expect.objectContaining({ approval_id: row.id, payload_hash: row.payload_hash }));

		const table = A.confirmationTable(row);
		expect(table.map((r) => r.label)).toEqual(['Recipient', 'Amount', 'Asset', 'Chain']);
		expect(table[0].full).toBe(RECIPIENT);
		expect(table[1].value).toContain('0.25 SOL');
		expect(table[3].value).toBe('Solana');
	});

	it('asks once per gated event: the same idempotency key or open source ref returns the first request', async () => {
		const input = request();
		const first = await A.createApprovalRequest(input);
		const again = await A.createApprovalRequest(input);
		const sameRef = await A.createApprovalRequest({ ...input, idempotencyKey: 'another-bucket' });
		expect(again.created).toBe(false);
		expect(again.request.id).toBe(first.request.id);
		expect(sameRef.request.id).toBe(first.request.id);
		expect(notify.insertNotification).toHaveBeenCalledTimes(1);
	});

	it('falls back to email when no out-of-app channel reached the owner', async () => {
		notify.insertNotification.mockResolvedValueOnce({ id: 1, in_app: true, delivered: { push: 0 } });
		await A.createApprovalRequest(request());
		expect(email.sendApprovalRequestEmail).toHaveBeenCalledTimes(1);
		const arg = email.sendApprovalRequestEmail.mock.calls[0][0];
		expect(arg.to).toBe('owner@example.com');
		expect(arg.link).toMatch(/^\/approvals\/[0-9a-f-]{36}\?t=a1\./);
	});

	it('refuses a source with no registered executor', async () => {
		await expect(A.createApprovalRequest(request({ source: 'nowhere' }))).rejects.toMatchObject({ code: 'unknown_source' });
	});
});

describe('signed deep links', () => {
	it('verify against the request on file and reject any edit', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		const token = new URL(A.approvalPath(row), 'https://x').searchParams.get('t');
		const facts = { id: row.id, userId: OWNER, hash: row.payload_hash };
		expect(A.verifyApprovalLink(token, facts)).toEqual({ ok: true });
		expect(A.verifyApprovalLink(token, { ...facts, hash: 'f'.repeat(64) })).toMatchObject({ reason: 'payload_changed' });
		expect(A.verifyApprovalLink(token, { ...facts, userId: STRANGER })).toMatchObject({ reason: 'wrong_request' });
		const [head, body, sig] = token.split('.');
		expect(A.verifyApprovalLink(`${head}.${body}.${sig.slice(0, -2)}xx`, facts)).toMatchObject({ reason: 'bad_signature' });
		expect(A.verifyApprovalLink('nonsense', facts)).toMatchObject({ reason: 'malformed' });

		const viewed = await A.getApproval(OWNER, row.id, { token });
		expect(viewed.link_verified).toBe(true);
	});

	it('a link that does not match blocks the decision', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		const { request: other } = await A.createApprovalRequest(request());
		const otherToken = new URL(A.approvalPath(other), 'https://x').searchParams.get('t');
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash, token: otherToken }))
			.rejects.toMatchObject({ status: 409, code: 'link_mismatch' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
	});
});

describe('approve', () => {
	it('executes exactly the shown action once and records the signature', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		const out = await A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash, via: 'push' });
		expect(out.idempotent).toBe(false);
		expect(out.request.status).toBe('executed');
		expect(out.request.signature).toBe('SIGtest1111');
		expect(out.request.decided_via).toBe('push');
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
		expect(executor.executeApprovedIntentAction.mock.calls[0][0].payload).toEqual(row.payload);
	});

	it('rejects a tampered payload hash and runs nothing', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		const tampered = A.payloadHash({ ...row.payload, destination: 'THREEsyntheticAttacker1111111111111111111' });
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: tampered }))
			.rejects.toMatchObject({ status: 409, code: 'payload_mismatch' });
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: null }))
			.rejects.toMatchObject({ status: 400, code: 'payload_hash_required' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		const [still] = (await dbState.pg.query('select status from approval_requests where id = $1', [row.id])).rows;
		expect(still.status).toBe('pending');
	});

	it('fails closed when the stored payload was edited after it was shown', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		// Someone rewrites the destination in the row but leaves the hash the owner saw.
		await dbState.pg.query(`update approval_requests set payload = jsonb_set(payload, '{destination}', '"THREEsyntheticAttacker1111111111111111111"') where id = $1`, [row.id]);
		const out = await A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash });
		expect(out.request.status).toBe('failed');
		expect(out.request.result.integrity).toBe(false);
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
	});

	it('an expired request cannot execute, even with the right hash', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		await dbState.pg.query(`update approval_requests set expires_at = now() - interval '1 second' where id = $1`, [row.id]);
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash }))
			.rejects.toMatchObject({ status: 410, code: 'expired' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		const [after] = (await dbState.pg.query('select status from approval_requests where id = $1', [row.id])).rows;
		expect(after.status).toBe('expired');
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash }))
			.rejects.toMatchObject({ status: 410 });
	});

	it('double approve is idempotent: concurrent and repeated taps run the executor once', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		const args = { userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash };
		const [a, b] = await Promise.all([A.decideApproval({ ...args, via: 'push' }), A.decideApproval({ ...args, via: 'web' })]);
		const third = await A.decideApproval(args);
		expect([a.idempotent, b.idempotent].filter(Boolean)).toHaveLength(1);
		expect(third.idempotent).toBe(true);
		expect(third.request.status).toBe('executed');
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
	});

	it('records a failed execution without retrying it', async () => {
		executor.executeApprovedIntentAction.mockResolvedValueOnce({ status: 'error', note: 'insufficient balance' });
		const { request: row } = await A.createApprovalRequest(request());
		const out = await A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash });
		expect(out.request.status).toBe('failed');
		expect(out.request.result.note).toBe('insufficient balance');
		const again = await A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash });
		expect(again.idempotent).toBe(true);
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
	});

	it('another account cannot see or decide the request', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		await expect(A.decideApproval({ userId: STRANGER, id: row.id, decision: 'approve', payloadHash: row.payload_hash }))
			.rejects.toMatchObject({ status: 404 });
		await expect(A.getApproval(STRANGER, row.id)).rejects.toMatchObject({ status: 404 });
	});
});

describe('deny', () => {
	it('is terminal: a denied request can never be approved', async () => {
		const { request: row } = await A.createApprovalRequest(request());
		const out = await A.decideApproval({ userId: OWNER, id: row.id, decision: 'deny' });
		expect(out.request.status).toBe('denied');
		const repeat = await A.decideApproval({ userId: OWNER, id: row.id, decision: 'deny' });
		expect(repeat.idempotent).toBe(true);
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash }))
			.rejects.toMatchObject({ status: 409, code: 'already_denied' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
	});

	it('bulk deny denies only pending requests on the caller account', async () => {
		const { request: one } = await A.createApprovalRequest(request());
		const { request: two } = await A.createApprovalRequest(request());
		const { request: done } = await A.createApprovalRequest(request());
		await A.decideApproval({ userId: OWNER, id: done.id, decision: 'approve', payloadHash: done.payload_hash });

		const foreign = await A.bulkDeny(STRANGER, [one.id]);
		expect(foreign.denied).toEqual([]);

		const out = await A.bulkDeny(OWNER, [one.id, two.id, done.id]);
		expect(out.denied.sort()).toEqual([one.id, two.id].sort());
		expect(out.skipped).toEqual([done.id]);
		await expect(A.bulkDeny(OWNER, ['not-a-uuid'])).rejects.toMatchObject({ code: 'no_ids' });
	});
});

describe('inbox listing', () => {
	it('groups by status, counts every group, and expires stale requests on read', async () => {
		const { request: live } = await A.createApprovalRequest(request());
		const { request: stale } = await A.createApprovalRequest(request());
		await dbState.pg.query(`update approval_requests set expires_at = now() - interval '1 minute' where id = $1`, [stale.id]);

		const pending = await A.listApprovals(OWNER, { group: 'pending' });
		expect(pending.items.map((i) => i.id)).toEqual([live.id]);
		expect(pending.counts).toMatchObject({ pending: 1, expired: 1, all: 2 });
		expect(pending.agents).toEqual([{ id: AGENT, name: 'Scout' }]);
		expect(pending.items[0].link).toMatch(/\?t=a1\./);

		const expired = await A.listApprovals(OWNER, { group: 'expired' });
		expect(expired.items.map((i) => i.id)).toEqual([stale.id]);
		await expect(A.listApprovals(OWNER, { group: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status' });
	});

	it('paginates with a cursor', async () => {
		for (let i = 0; i < 3; i += 1) await A.createApprovalRequest(request());
		const first = await A.listApprovals(OWNER, { group: 'all', limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.next_cursor).toBeTruthy();
		const second = await A.listApprovals(OWNER, { group: 'all', limit: 2, cursor: first.next_cursor });
		expect(second.items).toHaveLength(1);
		expect(second.next_cursor).toBeNull();
		expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(3);
	});
});

describe('auto-approve rules', () => {
	it('default is ask every time', async () => {
		const { autoApproved, request: row } = await A.createApprovalRequest(request());
		expect(autoApproved).toBe(false);
		expect(row.status).toBe('pending');
	});

	it('a rule covers only its venue and size, and never a never-paid address', async () => {
		const policy = await A.createAutoPolicy(OWNER, { venues: ['wallet_transfer'], max_usd: 50 });
		expect(policy.active).toBe(true);

		const covered = await A.matchAutoPolicy({ userId: OWNER, agentId: AGENT, venue: 'wallet_transfer', amountUsd: 40 });
		expect(covered?.id).toBe(policy.id);
		expect(await A.matchAutoPolicy({ userId: OWNER, agentId: AGENT, venue: 'wallet_transfer', amountUsd: 51 })).toBeNull();
		expect(await A.matchAutoPolicy({ userId: OWNER, agentId: AGENT, venue: 'jupiter', amountUsd: 5 })).toBeNull();
		expect(await A.matchAutoPolicy({ userId: OWNER, agentId: AGENT, venue: 'wallet_transfer', amountUsd: null })).toBeNull();
		expect(await A.matchAutoPolicy({ userId: OWNER, agentId: AGENT, venue: 'wallet_transfer', amountUsd: 5, autoApprovable: false })).toBeNull();
		expect(await A.matchAutoPolicy({ userId: STRANGER, venue: 'wallet_transfer', amountUsd: 5 })).toBeNull();
	});

	it('a covered request is created approved and still executes through runApproved once', async () => {
		await A.createAutoPolicy(OWNER, { venues: ['wallet_transfer'], max_usd: 50 });
		const { autoApproved, request: row } = await A.createApprovalRequest(request());
		expect(autoApproved).toBe(true);
		expect(row.status).toBe('approved');
		expect(row.decided_via).toBe('auto_policy');
		expect(notify.insertNotification).not.toHaveBeenCalled();

		const run = vi.fn(async () => ({ status: 'ok', signature: 'SIGauto1111' }));
		const first = await A.runApproved(row, run);
		const second = await A.runApproved(row, run);
		expect(first.request.status).toBe('executed');
		expect(second.outcome).toBeNull();
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('revoking a rule takes effect on the next request', async () => {
		const policy = await A.createAutoPolicy(OWNER, { venues: ['wallet_transfer'], max_usd: 50 });
		const revoked = await A.revokeAutoPolicy(OWNER, policy.id);
		expect(revoked.active).toBe(false);
		const { autoApproved } = await A.createApprovalRequest(request());
		expect(autoApproved).toBe(false);
		await expect(A.revokeAutoPolicy(STRANGER, policy.id)).rejects.toMatchObject({ status: 404 });
	});

	it('rules are capped and validated', async () => {
		await expect(A.createAutoPolicy(OWNER, { venues: ['wallet_transfer'], max_usd: A.AUTO_POLICY_MAX_USD + 1 })).rejects.toMatchObject({ code: 'invalid_max_usd' });
		await expect(A.createAutoPolicy(OWNER, { venues: ['somewhere'], max_usd: 10 })).rejects.toMatchObject({ code: 'invalid_venue' });
		await expect(A.createAutoPolicy(OWNER, { venues: [], max_usd: 10 })).rejects.toMatchObject({ code: 'invalid_venue' });
		await expect(A.createAutoPolicy(OWNER, { venues: ['jupiter'], max_usd: 10, agent_id: '44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ code: 'agent_not_found' });
		await expect(A.createAutoPolicy(OWNER, { venues: ['jupiter'], max_usd: 10, expires_at: '2000-01-01' })).rejects.toMatchObject({ code: 'invalid_expiry' });
	});
});
