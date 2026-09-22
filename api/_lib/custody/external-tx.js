// The external-signer contract: prepare, then submit.
//
//   prepareExternalTx  simulates an unsigned transaction, stores its exact
//                      message bytes in pending_external_txs, and returns a
//                      tx_id plus the base64 transaction for the wallet to sign.
//   submitExternalTx   takes that tx_id and the signed transaction, proves the
//                      expected key signed it, checks the signed message still
//                      carries every instruction that was prepared, broadcasts,
//                      confirms, and reconciles the result into
//                      agent_custody_events with the on-chain signature.
//
// The external path is confirmed by the signature itself: the platform never
// holds the key, so there is no confirm flag to check. What the platform does
// guarantee is that the ledger row describes the transaction that actually
// landed. Wallets are allowed to add instructions (priority fees, guard
// assertions); they are not allowed to drop or alter one we prepared.

import { PublicKey, VersionedTransaction, VersionedMessage } from '@solana/web3.js';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sql } from '../db.js';
import { solanaConnection } from '../solana/connection.js';
import { pollConfirmation } from '../solana/confirm.js';
import { recordCustodyEvent } from '../agent-trade-guards.js';
import { clientError } from './builders.js';

// A blockhash lives ~150 slots (about 60 to 90 seconds). The row outlives it a
// little so a late submit gets the precise "expired" answer instead of a 404.
export const PREPARED_TTL_MS = 150_000;
const MAX_LOG_LINES = 30;

// What each kind writes into the custody ledger once it confirms.
const LEDGER = {
	transfer: { eventType: 'spend', category: 'transfer' },
	withdraw: { eventType: 'withdraw', category: 'withdraw' },
	swap: { eventType: 'spend', category: 'trade' },
	session_grant: { eventType: 'signer_session_grant', category: 'custody' },
	session_revoke: { eventType: 'signer_session_revoke', category: 'custody' },
};

export const EXTERNAL_TX_KINDS = Object.freeze(Object.keys(LEDGER));

// Hooks other custody modules register to run after a kind confirms (the
// session grant flips the signer to active, the revoke finalizes it). Kept as
// a registry so this module never imports its callers.
const confirmHooks = new Map();

/** Register `fn(row, signature)` to run after a transaction of `kind` confirms. */
export function onExternalTxConfirmed(kind, fn) {
	confirmHooks.set(kind, fn);
}

function b64(bytes) {
	return Buffer.from(bytes).toString('base64');
}

function versionOf(tx) {
	return tx.message.version === 'legacy' ? 'legacy' : 'v0';
}

/**
 * Stable identity for every account a compiled message references. Static keys
 * resolve to their base58; lookup-table accounts resolve to table + index, which
 * is exactly as specific as the message itself.
 */
function accountIdentities(message) {
	const ids = message.staticAccountKeys.map((k) => k.toBase58());
	const lookups = message.addressTableLookups || [];
	for (const l of lookups) for (const i of l.writableIndexes) ids.push(`${l.accountKey.toBase58()}#w${i}`);
	for (const l of lookups) for (const i of l.readonlyIndexes) ids.push(`${l.accountKey.toBase58()}#r${i}`);
	return ids;
}

/** Each instruction as `program|account,account|datahex`, order preserved. */
export function instructionFingerprints(message) {
	const ids = accountIdentities(message);
	return message.compiledInstructions.map((ix) => {
		const program = ids[ix.programIdIndex];
		const accounts = ix.accountKeyIndexes.map((i) => ids[i]).join(',');
		return `${program}|${accounts}|${Buffer.from(ix.data).toString('hex')}`;
	});
}

/**
 * Compare the message we prepared with the one the wallet signed.
 * @returns {{ ok: boolean, modified: boolean, reason?: string }}
 */
export function compareMessages(preparedBytes, signedMessage) {
	const signedBytes = Buffer.from(signedMessage.serialize());
	if (Buffer.compare(Buffer.from(preparedBytes), signedBytes) === 0) return { ok: true, modified: false };

	const prepared = VersionedMessage.deserialize(Buffer.from(preparedBytes));
	if (!prepared.staticAccountKeys[0].equals(signedMessage.staticAccountKeys[0])) {
		return { ok: false, modified: true, reason: 'fee payer changed' };
	}
	if (prepared.recentBlockhash !== signedMessage.recentBlockhash) {
		return { ok: false, modified: true, reason: 'recent blockhash changed' };
	}
	const signedSet = new Map();
	for (const f of instructionFingerprints(signedMessage)) signedSet.set(f, (signedSet.get(f) || 0) + 1);
	for (const f of instructionFingerprints(prepared)) {
		const n = signedSet.get(f) || 0;
		if (n === 0) return { ok: false, modified: true, reason: 'a prepared instruction is missing or was altered' };
		signedSet.set(f, n - 1);
	}
	return { ok: true, modified: true };
}

/**
 * Verify every required signature on a signed transaction, and that `expected`
 * is one of the signers.
 * @returns {{ ok: boolean, reason?: string, signature?: string }}
 */
export function verifySignatures(tx, expected) {
	const message = tx.message;
	const messageBytes = message.serialize();
	const required = message.header.numRequiredSignatures;
	const signers = message.staticAccountKeys.slice(0, required).map((k) => k.toBase58());
	if (!signers.includes(expected)) return { ok: false, reason: `the expected signer ${expected} is not a signer of this transaction` };
	for (let i = 0; i < required; i++) {
		const sig = tx.signatures[i];
		if (!sig || sig.every((b) => b === 0)) return { ok: false, reason: `missing signature for ${signers[i]}` };
		let valid = false;
		try {
			valid = ed25519.verify(sig, messageBytes, message.staticAccountKeys[i].toBytes());
		} catch {
			valid = false;
		}
		if (!valid) return { ok: false, reason: `invalid signature for ${signers[i]}` };
	}
	return { ok: true, signature: bs58.encode(tx.signatures[0]) };
}

function trimLogs(logs) {
	if (!Array.isArray(logs)) return [];
	return logs.length > MAX_LOG_LINES ? logs.slice(-MAX_LOG_LINES) : logs;
}

/**
 * Simulate an unsigned transaction against the live cluster. Throws a 422 with
 * the program logs when it would fail, so nobody is asked to sign a
 * transaction that cannot land.
 */
export async function simulateUnsigned(connection, transaction) {
	let result;
	try {
		result = await connection.simulateTransaction(transaction, {
			sigVerify: false,
			replaceRecentBlockhash: false,
			commitment: 'confirmed',
		});
	} catch (err) {
		throw Object.assign(new Error(`simulation failed upstream: ${err?.message || 'rpc error'}`), {
			status: 502, code: 'upstream_error', expose: true,
		});
	}
	const v = result?.value || {};
	const simulation = {
		ok: !v.err,
		err: v.err ? JSON.stringify(v.err) : null,
		units_consumed: v.unitsConsumed ?? null,
		logs: trimLogs(v.logs),
	};
	if (v.err) {
		const e = clientError('simulation_failed', `The transaction would fail on-chain: ${simulation.err}`, 422);
		e.detail = { simulation };
		throw e;
	}
	return simulation;
}

/**
 * Store an unsigned transaction for an external signer.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {string|null} [p.agentId]
 * @param {string} p.kind            one of EXTERNAL_TX_KINDS
 * @param {'mainnet'|'devnet'} p.network
 * @param {string} p.signer          base58 key that must sign
 * @param {VersionedTransaction} p.transaction
 * @param {object} p.summary         what the transaction does, in plain fields
 * @param {number|null} [p.lastValidBlockHeight]
 * @param {boolean} [p.simulate=true]
 * @returns {Promise<object>}        the public prepared shape
 */
export async function prepareExternalTx({ userId, agentId = null, kind, network, signer, transaction, summary, lastValidBlockHeight = null, simulate = true, connection = null }) {
	if (!LEDGER[kind]) throw new Error(`unknown external tx kind: ${kind}`);
	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });
	const required = transaction.message.staticAccountKeys
		.slice(0, transaction.message.header.numRequiredSignatures)
		.map((k) => k.toBase58());
	if (!required.includes(signer)) throw new Error(`prepared transaction does not require a signature from ${signer}`);

	const simulation = simulate ? await simulateUnsigned(conn, transaction) : null;
	const messageB64 = b64(transaction.message.serialize());
	const txB64 = b64(transaction.serialize());
	const expiresAt = new Date(Date.now() + PREPARED_TTL_MS);

	const [row] = await sql`
		INSERT INTO pending_external_txs
			(user_id, agent_id, kind, network, signer_pubkey, message_b64, tx_b64, tx_version,
			 summary, simulation, last_valid_block_height, expires_at)
		VALUES
			(${userId}, ${agentId}, ${kind}, ${network}, ${signer}, ${messageB64}, ${txB64}, ${versionOf(transaction)},
			 ${JSON.stringify(summary || {})}::jsonb, ${simulation ? JSON.stringify(simulation) : null}::jsonb,
			 ${lastValidBlockHeight}, ${expiresAt.toISOString()})
		RETURNING id, created_at
	`;
	return {
		tx_id: row.id,
		signer: 'external',
		kind,
		network,
		signer_pubkey: signer,
		transaction: txB64,
		encoding: 'base64',
		version: versionOf(transaction),
		summary: summary || {},
		simulation,
		last_valid_block_height: lastValidBlockHeight,
		expires_at: expiresAt.toISOString(),
		submit: { method: 'POST', path: '/api/tx/submit', body: { tx_id: row.id, signed_transaction: '<base64>' } },
	};
}

/** The public view of a pending row. */
export function publicExternalTx(row) {
	return {
		tx_id: row.id,
		kind: row.kind,
		network: row.network,
		agent_id: row.agent_id,
		signer_pubkey: row.signer_pubkey,
		status: row.status,
		signature: row.signature,
		message_modified: row.message_modified,
		summary: row.summary,
		custody_event_id: row.custody_event_id,
		error: row.error,
		expires_at: row.expires_at,
		submitted_at: row.submitted_at,
		confirmed_at: row.confirmed_at,
		created_at: row.created_at,
	};
}

export async function getExternalTx(txId, userId) {
	const [row] = await sql`SELECT * FROM pending_external_txs WHERE id = ${txId} AND user_id = ${userId}`;
	return row || null;
}

export async function listExternalTxs(userId, { agentId = null, limit = 25 } = {}) {
	const lim = Math.min(100, Math.max(1, Number(limit) || 25));
	return sql`
		SELECT * FROM pending_external_txs
		WHERE user_id = ${userId} AND (${agentId}::uuid IS NULL OR agent_id = ${agentId})
		ORDER BY created_at DESC
		LIMIT ${lim}
	`;
}

function decodeSigned(signedB64) {
	if (typeof signedB64 !== 'string' || !signedB64.trim()) {
		throw clientError('invalid_transaction', 'signed_transaction must be a base64-encoded transaction');
	}
	try {
		return VersionedTransaction.deserialize(Buffer.from(signedB64.trim(), 'base64'));
	} catch {
		throw clientError('invalid_transaction', 'signed_transaction could not be decoded as a Solana transaction');
	}
}

async function reconcileToLedger(row, signature) {
	if (!row.agent_id) return null;
	const map = LEDGER[row.kind];
	const s = row.summary || {};
	const lamports = s.asset === 'SOL' && s.amount_raw ? s.amount_raw : null;
	return recordCustodyEvent({
		agentId: row.agent_id,
		userId: row.user_id,
		eventType: map.eventType,
		category: map.category,
		network: row.network,
		asset: s.asset ?? null,
		amountLamports: lamports,
		amountRaw: s.amount_raw ?? null,
		usd: typeof s.usd === 'number' ? s.usd : null,
		destination: s.to ?? s.output_mint ?? s.delegate ?? null,
		signature,
		reason: `external_${row.kind}`,
		status: 'confirmed',
		idempotencyKey: `external:${row.id}`,
		meta: {
			signer: 'external',
			signer_pubkey: row.signer_pubkey,
			tx_id: row.id,
			message_modified: row.message_modified,
			summary: s,
		},
	});
}

/**
 * Verify, broadcast, confirm, and reconcile a signed external transaction.
 * Idempotent: a repeat submit of a confirmed row returns it unchanged.
 */
export async function submitExternalTx({ userId, txId, signedTransaction, connection = null }) {
	const row = await getExternalTx(txId, userId);
	if (!row) throw clientError('not_found', 'No prepared transaction with that tx_id for this account.', 404);
	if (row.status === 'confirmed') return { ...publicExternalTx(row), replayed: true };
	if (row.status === 'submitted') throw clientError('in_flight', 'This transaction is already being submitted. Poll GET /api/tx/submit?tx_id= for its result.', 409);
	if (row.status === 'failed') throw clientError('already_failed', `This transaction already failed (${row.error || 'unknown error'}). Prepare a new one.`, 409);
	if (row.status === 'expired' || new Date(row.expires_at).getTime() < Date.now()) {
		await sql`UPDATE pending_external_txs SET status = 'expired', updated_at = now() WHERE id = ${row.id} AND status = 'prepared'`;
		throw clientError('expired', 'This prepared transaction expired before it was signed. Prepare it again; blockhashes are only valid for about a minute.', 410);
	}

	const tx = decodeSigned(signedTransaction);
	const cmp = compareMessages(Buffer.from(row.message_b64, 'base64'), tx.message);
	if (!cmp.ok) throw clientError('transaction_mismatch', `The signed transaction does not match what was prepared: ${cmp.reason}.`, 422);
	const sig = verifySignatures(tx, row.signer_pubkey);
	if (!sig.ok) throw clientError('invalid_signature', sig.reason, 422);

	// Claim the row: exactly one submit wins even under concurrent retries.
	const [claimed] = await sql`
		UPDATE pending_external_txs
		SET status = 'submitted', signature = ${sig.signature}, message_modified = ${cmp.modified},
		    submitted_at = now(), updated_at = now()
		WHERE id = ${row.id} AND status = 'prepared'
		RETURNING *
	`;
	if (!claimed) {
		const fresh = await getExternalTx(txId, userId);
		if (fresh?.status === 'confirmed') return { ...publicExternalTx(fresh), replayed: true };
		throw clientError('in_flight', 'This transaction is already being submitted.', 409);
	}

	const conn = connection || solanaConnection({ network: row.network, commitment: 'confirmed' });
	const raw = Buffer.from(tx.serialize());
	try {
		await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
	} catch (err) {
		const msg = String(err?.message || err);
		// A duplicate submit of an already-landed transaction is success, not failure.
		if (!/already been processed|AlreadyProcessed/i.test(msg)) {
			await markFailed(claimed.id, `broadcast rejected: ${msg.slice(0, 400)}`);
			throw clientError('broadcast_failed', `The network rejected the transaction: ${msg.slice(0, 300)}`, 422);
		}
	}

	const strategy = claimed.last_valid_block_height
		? { signature: sig.signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: Number(claimed.last_valid_block_height) }
		: sig.signature;
	let confirmation;
	try {
		confirmation = await pollConfirmation(conn, strategy, 'confirmed');
	} catch (err) {
		// Unknown outcome: leave it 'submitted' so a later GET re-checks the chain.
		throw Object.assign(new Error(`confirmation timed out: ${err?.message || 'unknown'}`), {
			status: 202, code: 'pending_confirmation', expose: true,
			detail: { tx_id: claimed.id, signature: sig.signature },
		});
	}
	if (confirmation?.value?.err) {
		await markFailed(claimed.id, `reverted on-chain: ${JSON.stringify(confirmation.value.err)}`);
		throw clientError('reverted', `The transaction landed but reverted: ${JSON.stringify(confirmation.value.err)}`, 422);
	}
	return finalizeConfirmed(claimed, sig.signature);
}

async function markFailed(id, message) {
	await sql`UPDATE pending_external_txs SET status = 'failed', error = ${message}, updated_at = now() WHERE id = ${id}`;
}

async function finalizeConfirmed(row, signature) {
	const custodyEventId = await reconcileToLedger(row, signature);
	const [done] = await sql`
		UPDATE pending_external_txs
		SET status = 'confirmed', confirmed_at = now(), custody_event_id = ${custodyEventId}, updated_at = now()
		WHERE id = ${row.id}
		RETURNING *
	`;
	const hook = confirmHooks.get(row.kind);
	if (hook) await hook(done, signature);
	return publicExternalTx(done);
}

/**
 * Re-check a 'submitted' row whose confirmation timed out. Returns the row as it
 * stands after the check.
 */
export async function refreshSubmittedTx(txId, userId, { connection = null } = {}) {
	const row = await getExternalTx(txId, userId);
	if (!row) return null;
	if (row.status !== 'submitted' || !row.signature) return publicExternalTx(row);
	const conn = connection || solanaConnection({ network: row.network, commitment: 'confirmed' });
	let status = null;
	try {
		const res = await conn.getSignatureStatuses([row.signature], { searchTransactionHistory: true });
		status = res?.value?.[0] || null;
	} catch {
		return publicExternalTx(row);
	}
	if (status?.err) {
		await markFailed(row.id, `reverted on-chain: ${JSON.stringify(status.err)}`);
		return publicExternalTx(await getExternalTx(txId, userId));
	}
	if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
		return finalizeConfirmed(row, row.signature);
	}
	if (!status && new Date(row.expires_at).getTime() + 60_000 < Date.now()) {
		const height = await conn.getBlockHeight('confirmed').catch(() => null);
		if (height != null && row.last_valid_block_height && height > Number(row.last_valid_block_height)) {
			await markFailed(row.id, 'expired: the blockhash lapsed before the transaction landed');
			return publicExternalTx(await getExternalTx(txId, userId));
		}
	}
	return publicExternalTx(row);
}

/** Normalize a base58 key or throw a 400 naming the field. */
export function requirePubkey(value, field) {
	try {
		const pk = new PublicKey(String(value || '').trim());
		return pk.toBase58();
	} catch {
		throw clientError('invalid_parameter', `${field} must be a base58 Solana address`);
	}
}
