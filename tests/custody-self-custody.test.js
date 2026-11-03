// Self-custody contract: session caps, external-signer verification, replay and
// expiry, and the signer-choice resolver. Only the database and the RPC
// Connection are faked; every check under test is the real library code, run
// against real signed Solana transactions.

import { ed25519 } from '@noble/curves/ed25519.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	Keypair, SystemProgram, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-self-custody';

const db = { rows: [], signer: null, updates: [] };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join('?');
		if (/FROM pending_external_txs/.test(text) && /SELECT/.test(text)) return db.rows.filter((r) => r.id === values[0]);
		if (/UPDATE pending_external_txs/.test(text) && /status = 'expired'/.test(text)) {
			for (const r of db.rows) if (r.id === values[0] && r.status === 'prepared') r.status = 'expired';
			return [];
		}
		if (/UPDATE pending_external_txs/.test(text) && /status = 'submitted'/.test(text)) {
			const row = db.rows.find((r) => r.id === values[2] && r.status === 'prepared');
			if (!row) return [];
			Object.assign(row, { status: 'submitted', signature: values[0], message_modified: values[1] });
			return [row];
		}
		if (/UPDATE pending_external_txs/.test(text) && /status = 'failed'/.test(text)) {
			const row = db.rows.find((r) => r.id === values[1]);
			if (row) Object.assign(row, { status: 'failed', error: values[0] });
			return [];
		}
		if (/UPDATE pending_external_txs/.test(text) && /status = 'confirmed'/.test(text)) {
			const row = db.rows.find((r) => r.id === values[1]);
			Object.assign(row, { status: 'confirmed', custody_event_id: values[0] });
			return [row];
		}
		if (/UPDATE agent_signers/.test(text) && /session_spent_raw \+/.test(text)) {
			const s = db.signer;
			const amount = BigInt(values[0]);
			const ok = s && s.mode === 'session' && s.session_status === 'active'
				&& new Date(s.session_expires_at).getTime() > Date.now()
				&& s.session_mint === values[2]
				&& BigInt(s.session_spent_raw) + amount <= BigInt(s.session_cap_raw);
			if (!ok) return [];
			s.session_spent_raw = String(BigInt(s.session_spent_raw) + amount);
			return [{ ...s }];
		}
		if (/FROM agent_signers/.test(text)) return db.signer ? [{ ...db.signer }] : [];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(async () => 4242) }));
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: vi.fn() }));
vi.mock('../api/_lib/solana/confirm.js', () => ({
	pollConfirmation: vi.fn(async () => ({ value: { err: null } })),
}));

const { sessionAllows, reserveSessionSpend, resolveSigningPath, parseSignerChoice } = await import('../api/_lib/custody/signing.js');
const { compareMessages, submitExternalTx, PREPARED_TTL_MS } = await import('../api/_lib/custody/external-tx.js');
const { recordCustodyEvent } = await import('../api/_lib/agent-trade-guards.js');

const AGENT = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BLOCKHASH = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';

function sessionRow(over = {}) {
	return {
		agent_id: AGENT,
		mode: 'session',
		session_pubkey: Keypair.generate().publicKey.toBase58(),
		session_status: 'active',
		session_network: 'mainnet',
		session_mint: USDC,
		session_decimals: 6,
		session_cap_raw: '1000000',
		session_spent_raw: '0',
		session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
		...over,
	};
}

function transferTx(payer, to, lamports, blockhash = BLOCKHASH, extra = []) {
	const message = new TransactionMessage({
		payerKey: payer.publicKey,
		recentBlockhash: blockhash,
		instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports }), ...extra],
	}).compileToV0Message();
	return new VersionedTransaction(message);
}

describe('session key caps', () => {
	it('refuses a 2 USDC transfer on a 1 USDC cap session', () => {
		const verdict = sessionAllows(sessionRow(), { mint: USDC, amountRaw: '2000000' });
		expect(verdict).toMatchObject({ ok: false, code: 'session_cap_exceeded', status: 403 });
	});

	it('allows a transfer that fits and refuses once the cap is used up', () => {
		expect(sessionAllows(sessionRow(), { mint: USDC, amountRaw: '1000000' })).toEqual({ ok: true });
		const used = sessionRow({ session_spent_raw: '600000' });
		expect(sessionAllows(used, { mint: USDC, amountRaw: '500000' })).toMatchObject({ ok: false, code: 'session_cap_exceeded' });
	});

	it('refuses an expired session, a wrong token and a wrong network', () => {
		const expired = sessionRow({ session_expires_at: new Date(Date.now() - 1000).toISOString() });
		expect(sessionAllows(expired, { mint: USDC, amountRaw: '1' })).toMatchObject({ ok: false, code: 'session_expired' });
		expect(sessionAllows(sessionRow(), { mint: Keypair.generate().publicKey.toBase58(), amountRaw: '1' })).toMatchObject({ ok: false, code: 'session_wrong_asset' });
		expect(sessionAllows(sessionRow(), { mint: USDC, amountRaw: '1', network: 'devnet' })).toMatchObject({ ok: false, code: 'session_wrong_network' });
	});

	describe('reserveSessionSpend', () => {
		beforeEach(() => { db.signer = sessionRow(); });

		it('rejects the 2 USDC claim on a 1 USDC cap with a 403 and leaves spend untouched', async () => {
			await expect(reserveSessionSpend(AGENT, { mint: USDC, amountRaw: '2000000', network: 'mainnet' }))
				.rejects.toMatchObject({ code: 'session_cap_exceeded', status: 403 });
			expect(db.signer.session_spent_raw).toBe('0');
		});

		it('claims headroom atomically and refuses the claim that would overflow it', async () => {
			await reserveSessionSpend(AGENT, { mint: USDC, amountRaw: '700000', network: 'mainnet' });
			await expect(reserveSessionSpend(AGENT, { mint: USDC, amountRaw: '400000', network: 'mainnet' }))
				.rejects.toMatchObject({ code: 'session_cap_exceeded' });
			expect(db.signer.session_spent_raw).toBe('700000');
		});

		it('refuses an expired session', async () => {
			db.signer = sessionRow({ session_expires_at: new Date(Date.now() - 1000).toISOString() });
			await expect(reserveSessionSpend(AGENT, { mint: USDC, amountRaw: '1', network: 'mainnet' }))
				.rejects.toMatchObject({ code: 'session_expired' });
		});
	});
});

describe('compareMessages', () => {
	const payer = Keypair.generate();
	const dest = Keypair.generate().publicKey;

	it('accepts the identical message', () => {
		const tx = transferTx(payer, dest, 1000);
		expect(compareMessages(tx.message.serialize(), tx.message)).toEqual({ ok: true, modified: false });
	});

	it('rejects a signed message whose instruction was altered', () => {
		const prepared = transferTx(payer, dest, 1000);
		const tampered = transferTx(payer, dest, 999_999);
		const verdict = compareMessages(prepared.message.serialize(), tampered.message);
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toMatch(/missing or was altered/);
	});

	it('rejects a swapped recipient and a changed fee payer', () => {
		const prepared = transferTx(payer, dest, 1000);
		expect(compareMessages(prepared.message.serialize(), transferTx(payer, Keypair.generate().publicKey, 1000).message).ok).toBe(false);
		const other = Keypair.generate();
		expect(compareMessages(prepared.message.serialize(), transferTx(other, dest, 1000).message)).toMatchObject({ ok: false, reason: 'fee payer changed' });
	});

	it('allows a wallet to append an instruction without dropping any', () => {
		const prepared = transferTx(payer, dest, 1000);
		const extra = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: dest, lamports: 1 });
		const signed = transferTx(payer, dest, 1000, BLOCKHASH, [extra]);
		expect(compareMessages(prepared.message.serialize(), signed.message)).toEqual({ ok: true, modified: true });
	});
});

describe('submitExternalTx', () => {
	const owner = Keypair.generate();
	const dest = Keypair.generate().publicKey;
	const conn = () => ({
		sendRawTransaction: vi.fn(async () => 'sig'),
		getBlockHeight: vi.fn(async () => 1),
	});

	function prepared(over = {}) {
		const tx = transferTx(owner, dest, 5000);
		const row = {
			id: '77777777-7777-4777-8777-777777777777',
			user_id: USER,
			agent_id: AGENT,
			kind: 'transfer',
			network: 'devnet',
			signer_pubkey: owner.publicKey.toBase58(),
			message_b64: Buffer.from(tx.message.serialize()).toString('base64'),
			status: 'prepared',
			summary: { asset: 'SOL', amount_raw: '5000', to: dest.toBase58() },
			expires_at: new Date(Date.now() + PREPARED_TTL_MS).toISOString(),
			last_valid_block_height: null,
			...over,
		};
		db.rows = [row];
		return { row, tx };
	}
	const signedB64 = (tx, kp) => {
		const copy = VersionedTransaction.deserialize(tx.serialize());
		copy.sign([kp]);
		return Buffer.from(copy.serialize()).toString('base64');
	};

	beforeEach(() => { recordCustodyEvent.mockClear(); });

	it('broadcasts a correctly signed transaction and writes the ledger row once', async () => {
		const { row, tx } = prepared();
		const c = conn();
		const out = await submitExternalTx({ userId: USER, txId: row.id, signedTransaction: signedB64(tx, owner), connection: c });
		expect(out.status).toBe('confirmed');
		expect(c.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(recordCustodyEvent).toHaveBeenCalledWith(expect.objectContaining({ agentId: AGENT, idempotencyKey: `external:${row.id}`, reason: 'external_transfer' }));
	});

	it('rejects a transaction whose signature was made by the wrong key', async () => {
		const { row, tx } = prepared();
		const c = conn();
		const forged = VersionedTransaction.deserialize(tx.serialize());
		const stranger = Keypair.generate();
		forged.signatures[0] = ed25519.sign(forged.message.serialize(), stranger.secretKey.slice(0, 32));
		await expect(submitExternalTx({ userId: USER, txId: row.id, signedTransaction: Buffer.from(forged.serialize()).toString('base64'), connection: c }))
			.rejects.toMatchObject({ code: 'invalid_signature', status: 422 });
		expect(c.sendRawTransaction).not.toHaveBeenCalled();
	});

	it('rejects an unsigned transaction', async () => {
		const { row, tx } = prepared();
		await expect(submitExternalTx({ userId: USER, txId: row.id, signedTransaction: Buffer.from(tx.serialize()).toString('base64'), connection: conn() }))
			.rejects.toMatchObject({ code: 'invalid_signature' });
	});

	it('rejects a signed transaction that differs from the prepared bytes', async () => {
		const { row } = prepared();
		const other = transferTx(owner, dest, 9_000_000);
		const c = conn();
		await expect(submitExternalTx({ userId: USER, txId: row.id, signedTransaction: signedB64(other, owner), connection: c }))
			.rejects.toMatchObject({ code: 'transaction_mismatch', status: 422 });
		expect(c.sendRawTransaction).not.toHaveBeenCalled();
	});

	it('rejects an expired prepared row with 410 and never broadcasts', async () => {
		const { row, tx } = prepared({ expires_at: new Date(Date.now() - 1000).toISOString() });
		const c = conn();
		await expect(submitExternalTx({ userId: USER, txId: row.id, signedTransaction: signedB64(tx, owner), connection: c }))
			.rejects.toMatchObject({ code: 'expired', status: 410 });
		expect(c.sendRawTransaction).not.toHaveBeenCalled();
		expect(db.rows[0].status).toBe('expired');
	});

	it('answers a replay of a confirmed row without broadcasting twice', async () => {
		const { row, tx } = prepared();
		const c = conn();
		const signed = signedB64(tx, owner);
		await submitExternalTx({ userId: USER, txId: row.id, signedTransaction: signed, connection: c });
		const again = await submitExternalTx({ userId: USER, txId: row.id, signedTransaction: signed, connection: c });
		expect(again.replayed).toBe(true);
		expect(c.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(recordCustodyEvent).toHaveBeenCalledTimes(1);
	});

	it('answers 404 for an unknown tx_id', async () => {
		db.rows = [];
		await expect(submitExternalTx({ userId: USER, txId: '88888888-8888-4888-8888-888888888888', signedTransaction: 'AA==', connection: conn() }))
			.rejects.toMatchObject({ code: 'not_found', status: 404 });
	});

	it('refuses a row that is already in flight', async () => {
		const { row, tx } = prepared({ status: 'submitted' });
		await expect(submitExternalTx({ userId: USER, txId: row.id, signedTransaction: signedB64(tx, owner), connection: conn() }))
			.rejects.toMatchObject({ code: 'in_flight', status: 409 });
	});
});

describe('resolveSigningPath', () => {
	const wallet = Keypair.generate().publicKey.toBase58();

	it('honours signer "external" on a platform-mode agent', async () => {
		const out = await resolveSigningPath({ agentId: AGENT, userId: USER, requested: 'external', signerPubkey: wallet, signerRow: { agent_id: AGENT, mode: 'platform' } });
		expect(out).toEqual({ path: 'external', pubkey: wallet, reason: 'requested' });
	});

	it('routes an external-mode agent to its registered key and refuses a different one', async () => {
		const registered = Keypair.generate().publicKey.toBase58();
		const row = { agent_id: AGENT, mode: 'external', external_pubkey: registered };
		expect(await resolveSigningPath({ agentId: AGENT, userId: USER, signerRow: row })).toMatchObject({ path: 'external', pubkey: registered });
		await expect(resolveSigningPath({ agentId: AGENT, userId: USER, signerPubkey: wallet, signerRow: row })).rejects.toMatchObject({ code: 'signer_mismatch' });
	});

	it('keeps platform mode custodial and refuses an explicit platform request on an external agent', async () => {
		expect(await resolveSigningPath({ agentId: AGENT, userId: USER, signerRow: { agent_id: AGENT, mode: 'platform' } })).toEqual({ path: 'custodial' });
		await expect(resolveSigningPath({ agentId: AGENT, userId: USER, requested: 'platform', signerRow: { agent_id: AGENT, mode: 'external', external_pubkey: wallet } }))
			.rejects.toMatchObject({ code: 'platform_signing_disabled', status: 409 });
	});

	it('uses the session path only for session-capable actions', async () => {
		const row = sessionRow({ external_pubkey: wallet });
		expect(await resolveSigningPath({ agentId: AGENT, userId: USER, sessionCapable: true, signerRow: row })).toMatchObject({ path: 'session' });
		expect(await resolveSigningPath({ agentId: AGENT, userId: USER, sessionCapable: false, signerRow: row })).toMatchObject({ path: 'external', reason: 'outside_session_scope' });
	});

	it('parseSignerChoice normalizes and rejects unknown modes', () => {
		expect(parseSignerChoice(' External ')).toBe('external');
		expect(parseSignerChoice(undefined)).toBeNull();
		expect(() => parseSignerChoice('hot')).toThrow(/signer must be/);
	});
});
