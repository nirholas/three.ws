// Burner approvals against the REAL approval_requests migration (PGlite):
//   - an over-cap request waits the owner's configured window (default 10 min);
//   - above confirmAboveUsd it demands an ed25519 signature from a linked wallet;
//   - a signature for another request, an unlinked wallet or a missing signature
//     is refused and nothing runs;
//   - an expired request can never execute;
//   - the owner-sign requirement lives in the hashed payload, so editing it out
//     of the row fails the integrity check.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

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
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/notify.js', () => ({
	insertNotification: vi.fn(async () => ({ id: 1, in_app: true, delivered: { push: 1 } })),
	emailAllowedForType: vi.fn(async () => true),
}));
vi.mock('../api/_lib/email.js', () => ({ sendApprovalRequestEmail: vi.fn(async () => ({ id: 'e' })) }));
const executor = vi.hoisted(() => ({ executeApprovedIntentAction: vi.fn(async () => ({ status: 'ok', signature: 'SIGtest1111', usd: 12 })) }));
vi.mock('../api/_lib/wallet-intents.js', () => executor);

const A = await import('../api/_lib/approvals.js');

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261010120000_approval_requests.sql', import.meta.url), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const ownerKey = Keypair.generate();
const strangerKey = Keypair.generate();
const sign = (kp, message) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32)));

let seq = 0;
function request(amountUsd, overrides = {}) {
	seq += 1;
	return {
		userId: OWNER, agentId: AGENT, source: 'wallet_intent', sourceRef: `b-${seq}`,
		actionType: 'transfer_sol', venue: 'wallet_transfer',
		payload: { v: 1, source: 'wallet_intent', intent_id: `b-${seq}`, destination: THREE_MINT },
		summary: `Send ${amountUsd} USD`, amount: 1, amountUsd, asset: 'SOL', chain: 'solana', network: 'devnet',
		recipient: THREE_MINT, idempotencyKey: `burner-test:${seq}`, ...overrides,
	};
}

async function setPolicy(policy) {
	await dbState.pg.query(`update agent_identities set meta = $1::jsonb where id = $2`, [JSON.stringify({ burner_policy: policy }), AGENT]);
}

beforeAll(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(`
		create table users (id uuid primary key, email text, wallet_address text);
		create table user_wallets (user_id uuid, chain_type text, address text);
		create table agent_identities (id uuid primary key, user_id uuid, name text, deleted_at timestamptz, meta jsonb default '{}'::jsonb);
		insert into users (id, email) values ('${OWNER}', 'owner@example.com');
		insert into user_wallets (user_id, chain_type, address) values ('${OWNER}', 'solana', '${ownerKey.publicKey.toBase58()}');
		insert into agent_identities (id, user_id, name) values ('${AGENT}', '${OWNER}', 'Scout');
	`);
	await dbState.pg.exec(MIGRATION);
});

beforeEach(async () => {
	await dbState.pg.exec('delete from approval_requests; delete from approval_auto_policies;');
	await setPolicy({ autoMaxUsd: 25, dailyAutoMaxUsd: 60, confirmAboveUsd: 500, expiryMinutes: 10 });
	executor.executeApprovedIntentAction.mockClear();
});

describe('burner approval requests', () => {
	it('waits the default 10 minutes and never auto-approves', async () => {
		const { request: row, autoApproved } = await A.createApprovalRequest(request(100));
		expect(autoApproved).toBe(false);
		expect(row.status).toBe('pending');
		const ttl = new Date(row.expires_at).getTime() - Date.now();
		expect(ttl).toBeGreaterThan(9 * 60_000);
		expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);
		expect(row.payload._burner.tier).toBe('confirm');
		expect(A.requiresWalletSignature(row)).toBe(false);
	});

	it('honours a shorter owner-configured window', async () => {
		await setPolicy({ autoMaxUsd: 25, expiryMinutes: 3 });
		const { request: row } = await A.createApprovalRequest(request(100));
		expect(new Date(row.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(3 * 60_000 + 1000);
	});

	it('a daily-total escalation of an in-cap amount still gets the burner window', async () => {
		const { request: row } = await A.createApprovalRequest(request(10, { burnerGated: true }));
		expect(row.payload._burner.tier).toBe('confirm');
		expect(new Date(row.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000 + 1000);
	});

	it('carries recipient, amount, token and chain in the confirmation table', async () => {
		const { request: row } = await A.createApprovalRequest(request(100));
		const table = Object.fromEntries(A.confirmationTable(row).map((r) => [r.label, r]));
		expect(table.Recipient.full).toBe(THREE_MINT);
		expect(table.Amount.value).toContain('SOL');
		expect(table.Asset.value).toBe('SOL');
		expect(table.Chain.value).toMatch(/Solana/);
	});

	it('an agent with no burner cap is untouched', async () => {
		await setPolicy({});
		const { request: row } = await A.createApprovalRequest(request(100));
		expect(row.payload._burner).toBeUndefined();
	});
});

describe('owner-sign tier', () => {
	async function ownerSignRow() {
		const { request: row } = await A.createApprovalRequest(request(900));
		expect(A.requiresWalletSignature(row)).toBe(true);
		return row;
	}

	it('refuses a tap with no signature and runs nothing', async () => {
		const row = await ownerSignRow();
		await expect(A.decideApproval({ userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash }))
			.rejects.toMatchObject({ status: 403, code: 'wallet_signature_required' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
	});

	it('refuses a signature from a wallet that is not linked to the owner', async () => {
		const row = await ownerSignRow();
		const message = A.signMessageFor(row);
		await expect(A.decideApproval({
			userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash,
			walletSignature: { address: strangerKey.publicKey.toBase58(), signature: sign(strangerKey, message) },
		})).rejects.toMatchObject({ status: 403, code: 'wallet_signature_invalid' });
	});

	it('refuses a signature made over a different request', async () => {
		const row = await ownerSignRow();
		const other = await A.createApprovalRequest(request(901));
		await expect(A.decideApproval({
			userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash,
			walletSignature: { address: ownerKey.publicKey.toBase58(), signature: sign(ownerKey, A.signMessageFor(other.request)) },
		})).rejects.toMatchObject({ code: 'wallet_signature_invalid' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
	});

	it('approves with a valid signature from a linked wallet', async () => {
		const row = await ownerSignRow();
		const out = await A.decideApproval({
			userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash,
			walletSignature: { address: ownerKey.publicKey.toBase58(), signature: sign(ownerKey, A.signMessageFor(row)) },
		});
		expect(out.request.status).toBe('approved');
	});

	it('an expired owner-sign request cannot execute even with a valid signature', async () => {
		const row = await ownerSignRow();
		await dbState.pg.query(`update approval_requests set expires_at = now() - interval '1 second' where id = $1`, [row.id]);
		await expect(A.decideApproval({
			userId: OWNER, id: row.id, decision: 'approve', payloadHash: row.payload_hash,
			walletSignature: { address: ownerKey.publicKey.toBase58(), signature: sign(ownerKey, A.signMessageFor(row)) },
		})).rejects.toMatchObject({ status: 410, code: 'expired' });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		const [after] = (await dbState.pg.query('select status from approval_requests where id = $1', [row.id])).rows;
		expect(after.status).toBe('expired');
	});

	it('stripping the requirement from the stored payload fails the integrity check', async () => {
		const row = await ownerSignRow();
		const edited = { ...row.payload, _burner: { ...row.payload._burner, tier: 'confirm' } };
		await dbState.pg.query(`update approval_requests set payload = $1::jsonb, status = 'approved' where id = $2`, [JSON.stringify(edited), row.id]);
		const stored = (await dbState.pg.query('select * from approval_requests where id = $1', [row.id])).rows[0];
		const { outcome } = await A.runApproved(stored, async () => { throw new Error('executor must not run'); });
		expect(outcome.integrity).toBe(true);
		expect(outcome.status).toBe('error');
	});
});
