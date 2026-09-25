// Session keys: let an agent act unattended from the OWNER's wallet, within a
// cap and an expiry the owner signed for.
//
// Grant. The platform generates a delegate keypair and stores its secret with
// the same secret box as every custodial key. The owner signs ONE transaction
// from their own wallet that (1) opens their token account for the session mint
// if needed, (2) approves the delegate for exactly the cap with SPL
// ApproveChecked, and (3) funds the delegate with a small SOL float for network
// fees. The approval is the on-chain enforcement: the token program refuses any
// delegate transfer beyond it. The platform enforces the same cap and the expiry
// on its side (reserveSessionSpend), so a spend is refused before it is ever
// built. The session turns active only when the grant confirms on chain.
//
// Spend. sendSessionTransfer claims headroom atomically, builds a TransferChecked
// from the owner's token account with the delegate as authority and fee payer,
// signs with the delegate key, sends, confirms, and records the spend in the
// custody ledger. A failure before landing releases the claimed headroom.
//
// Revoke. Any mode change away from session ends the session immediately in the
// database, destroys the delegate secret after returning its SOL float, and hands
// the owner an on-chain Revoke to sign so the approval disappears too.

import {
	Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
	createApproveCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction,
	createRevokeInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

import { sql } from '../db.js';
import { encryptSecret, decryptSecret } from '../secret-box.js';
import { solanaConnection } from '../solana/connection.js';
import { pollConfirmation } from '../solana/confirm.js';
import { recordCustodyEvent } from '../agent-trade-guards.js';
import {
	USDC_MINT_BY_NETWORK, clientError, resolveMint, toRawUnits, toVersioned, upstreamError,
} from './builders.js';
import { onExternalTxConfirmed, prepareExternalTx, requirePubkey } from './external-tx.js';
import {
	SESSION_MAX_CAP_UI, SESSION_MAX_HOURS, SESSION_MIN_HOURS, getAgentSigner, reserveSessionSpend,
} from './signing.js';

// Enough for roughly a thousand delegate-paid transfers at the base fee, and
// comfortably above the rent-exempt minimum of an empty system account.
export const SESSION_FEE_LAMPORTS = 5_000_000;

/**
 * Validate a session grant request. Pure.
 * @returns {{ capUi: number, hours: number, network: 'mainnet'|'devnet', mint: string }}
 */
export function parseSessionGrant(body = {}) {
	const capUi = Number(body.cap ?? body.cap_usdc);
	if (!Number.isFinite(capUi) || capUi <= 0) throw clientError('invalid_parameter', 'cap must be a positive amount (for example 25 for 25 USDC)');
	if (capUi > SESSION_MAX_CAP_UI) throw clientError('invalid_parameter', `cap is limited to ${SESSION_MAX_CAP_UI} per session`);
	const hours = Number(body.expires_in_hours ?? 24);
	if (!Number.isFinite(hours) || hours < SESSION_MIN_HOURS || hours > SESSION_MAX_HOURS) {
		throw clientError('invalid_parameter', `expires_in_hours must be between ${SESSION_MIN_HOURS} and ${SESSION_MAX_HOURS}`);
	}
	const network = body.network === 'devnet' ? 'devnet' : 'mainnet';
	const mint = body.mint ? requirePubkey(body.mint, 'mint') : USDC_MINT_BY_NETWORK[network];
	return { capUi, hours: Math.round(hours), network, mint };
}

async function tokenProgramOf(connection, mint) {
	const info = await connection.getAccountInfo(new PublicKey(mint));
	if (!info) throw clientError('invalid_mint', 'session mint not found on this network');
	if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
	if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
	throw clientError('invalid_mint', 'session mint is not an SPL token mint');
}

/**
 * Build the owner-signed grant transaction for a fresh delegate. Pure apart
 * from the chain reads it needs (mint, blockhash).
 */
export async function buildSessionGrantTransaction({ connection, owner, delegate, mint, capUi, feeLamports = SESSION_FEE_LAMPORTS }) {
	const ownerPk = new PublicKey(owner);
	const mintPk = new PublicKey(mint);
	const delegatePk = new PublicKey(delegate);
	const { programId, decimals } = await resolveMint(connection, mintPk);
	const capRaw = toRawUnits(capUi, decimals);
	if (capRaw <= 0n) throw clientError('invalid_parameter', `cap rounds to zero at ${decimals} decimals`);
	const ownerAta = getAssociatedTokenAddressSync(mintPk, ownerPk, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);

	const tx = new Transaction();
	tx.add(createAssociatedTokenAccountIdempotentInstruction(ownerPk, ownerAta, ownerPk, mintPk, programId, ASSOCIATED_TOKEN_PROGRAM_ID));
	tx.add(createApproveCheckedInstruction(ownerAta, mintPk, delegatePk, ownerPk, capRaw, decimals, [], programId));
	tx.add(SystemProgram.transfer({ fromPubkey: ownerPk, toPubkey: delegatePk, lamports: feeLamports }));
	let bh;
	try {
		bh = await connection.getLatestBlockhash('confirmed');
	} catch (err) {
		throw upstreamError(`blockhash fetch failed upstream: ${err?.message || 'rpc error'}`);
	}
	tx.feePayer = ownerPk;
	tx.recentBlockhash = bh.blockhash;
	return {
		transaction: toVersioned(tx),
		lastValidBlockHeight: bh.lastValidBlockHeight,
		decimals,
		capRaw,
		programId,
	};
}

/**
 * Start a session grant: store the pending delegate and return the prepared
 * transaction the owner signs. The agent's mode does not change until the
 * grant confirms (see the confirm hook below).
 */
export async function beginSessionGrant({ agentId, userId, owner, body, connection = null }) {
	const ownerKey = requirePubkey(owner, 'pubkey');
	const { capUi, hours, network, mint } = parseSessionGrant(body);
	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });

	const current = await getAgentSigner(agentId);
	if (current.mode === 'session' && current.session_status === 'active' && new Date(current.session_expires_at).getTime() > Date.now()) {
		throw clientError('session_active', 'This agent already has an active session key. Revoke it (switch the mode) before granting a new one.', 409);
	}

	const delegate = Keypair.generate();
	const delegateAddress = delegate.publicKey.toBase58();
	const built = await buildSessionGrantTransaction({ connection: conn, owner: ownerKey, delegate: delegateAddress, mint, capUi });
	const secretEnc = await encryptSecret(Buffer.from(delegate.secretKey).toString('base64'));
	const expiresAt = new Date(Date.now() + hours * 3600_000);

	await sql`
		INSERT INTO agent_signers
			(agent_id, user_id, mode, external_pubkey, session_pubkey, session_secret_enc, session_network,
			 session_mint, session_decimals, session_cap_raw, session_cap_usd, session_spent_raw,
			 session_expires_at, session_status, session_grant_signature, session_fee_lamports, updated_at)
		VALUES
			(${agentId}, ${userId}, ${current.mode || 'platform'}, ${ownerKey}, ${delegateAddress}, ${secretEnc}, ${network},
			 ${mint}, ${built.decimals}, ${built.capRaw.toString()}::numeric, ${mint === USDC_MINT_BY_NETWORK[network] ? capUi : null}, 0,
			 ${expiresAt.toISOString()}, 'pending', NULL, ${SESSION_FEE_LAMPORTS}, now())
		ON CONFLICT (agent_id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			external_pubkey = EXCLUDED.external_pubkey,
			session_pubkey = EXCLUDED.session_pubkey,
			session_secret_enc = EXCLUDED.session_secret_enc,
			session_network = EXCLUDED.session_network,
			session_mint = EXCLUDED.session_mint,
			session_decimals = EXCLUDED.session_decimals,
			session_cap_raw = EXCLUDED.session_cap_raw,
			session_cap_usd = EXCLUDED.session_cap_usd,
			session_spent_raw = 0,
			session_expires_at = EXCLUDED.session_expires_at,
			session_status = 'pending',
			session_grant_signature = NULL,
			session_fee_lamports = EXCLUDED.session_fee_lamports,
			updated_at = now()
	`;

	return prepareExternalTx({
		userId,
		agentId,
		kind: 'session_grant',
		network,
		signer: ownerKey,
		transaction: built.transaction,
		lastValidBlockHeight: built.lastValidBlockHeight,
		connection: conn,
		summary: {
			action: 'session_grant',
			delegate: delegateAddress,
			owner: ownerKey,
			asset: mint,
			decimals: built.decimals,
			amount_raw: built.capRaw.toString(),
			amount: capUi,
			fee_float_lamports: SESSION_FEE_LAMPORTS,
			expires_at: expiresAt.toISOString(),
			network,
		},
	});
}

// Flip the session live once the owner's grant lands. Matching on the delegate
// makes a stale grant (superseded by a newer one) a no-op.
onExternalTxConfirmed('session_grant', async (row, signature) => {
	await sql`
		UPDATE agent_signers
		SET mode = 'session', session_status = 'active', session_grant_signature = ${signature}, updated_at = now()
		WHERE agent_id = ${row.agent_id} AND session_pubkey = ${row.summary?.delegate || ''} AND session_status = 'pending'
	`;
});

onExternalTxConfirmed('session_revoke', async (row, signature) => {
	await sql`
		UPDATE agent_signers
		SET session_grant_signature = COALESCE(session_grant_signature, ${signature}), updated_at = now()
		WHERE agent_id = ${row.agent_id}
	`;
});

/**
 * End the current session: stop the platform from using the delegate at once,
 * return the delegate's SOL float to the owner (signed by the delegate, fees
 * paid by the owner inside the same revoke transaction), and prepare the
 * owner-signed on-chain Revoke. Returns null when there is nothing to revoke.
 */
export async function endSession({ agentId, userId, connection = null }) {
	const row = await getAgentSigner(agentId);
	if (!row.session_pubkey || !row.session_secret_enc || !row.external_pubkey) return null;
	const network = row.session_network || 'mainnet';
	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });

	// Stop the key server-side first: whatever happens on chain next, the
	// platform will not sign with it again.
	await sql`
		UPDATE agent_signers SET session_status = 'revoked', updated_at = now()
		WHERE agent_id = ${agentId} AND session_pubkey = ${row.session_pubkey}
	`;

	const owner = new PublicKey(row.external_pubkey);
	const delegateKp = Keypair.fromSecretKey(Buffer.from(await decryptSecret(row.session_secret_enc), 'base64'));
	const mintPk = new PublicKey(row.session_mint);
	const programId = await tokenProgramOf(conn, row.session_mint);
	const ownerAta = getAssociatedTokenAddressSync(mintPk, owner, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);

	let floatLamports = 0;
	try {
		floatLamports = await conn.getBalance(delegateKp.publicKey, 'confirmed');
	} catch (err) {
		throw upstreamError(`delegate balance read failed upstream: ${err?.message || 'rpc error'}`);
	}
	const bh = await conn.getLatestBlockhash('confirmed');
	const instructions = [createRevokeInstruction(ownerAta, owner, [], programId)];
	if (floatLamports > 0) {
		instructions.push(SystemProgram.transfer({ fromPubkey: delegateKp.publicKey, toPubkey: owner, lamports: floatLamports }));
	}
	const message = new TransactionMessage({ payerKey: owner, recentBlockhash: bh.blockhash, instructions }).compileToV0Message();
	const tx = new VersionedTransaction(message);
	if (floatLamports > 0) tx.sign([delegateKp]);

	// The delegate secret is no longer needed: its only remaining signature is
	// already on the revoke transaction.
	await sql`
		UPDATE agent_signers SET session_secret_enc = NULL, updated_at = now()
		WHERE agent_id = ${agentId} AND session_pubkey = ${row.session_pubkey}
	`;
	await recordCustodyEvent({
		agentId, userId, eventType: 'signer_session_end', category: 'custody', network,
		reason: 'owner_mode_change', status: 'ok',
		meta: { delegate: row.session_pubkey, owner: row.external_pubkey, float_lamports: floatLamports },
	});

	return prepareExternalTx({
		userId,
		agentId,
		kind: 'session_revoke',
		network,
		signer: owner.toBase58(),
		transaction: tx,
		lastValidBlockHeight: bh.lastValidBlockHeight,
		connection: conn,
		summary: {
			action: 'session_revoke',
			delegate: row.session_pubkey,
			owner: row.external_pubkey,
			asset: row.session_mint,
			float_returned_lamports: floatLamports,
			network,
		},
	});
}

/**
 * Transfer from the owner's wallet under the agent's session key. Refuses
 * before building when the cap, expiry, mint or network does not allow it.
 *
 * @returns {Promise<{ signature: string, amount: number, amount_raw: string, destination: string,
 *   mint: string, network: string, custody_event_id: number|null, session: { remaining_raw: string } }>}
 */
export async function sendSessionTransfer({ agentId, userId, destination, amount, mint = null, network = null, connection = null, reason = 'session_transfer' }) {
	const signer = await getAgentSigner(agentId);
	const net = network || signer.session_network || 'mainnet';
	const assetMint = mint || signer.session_mint;
	const decimals = Number(signer.session_decimals ?? 6);
	const dest = requirePubkey(destination, 'destination');
	const amountRaw = toRawUnits(amount, decimals);

	const claim = await reserveSessionSpend(agentId, { mint: assetMint, amountRaw, network: net });
	const conn = connection || solanaConnection({ network: net, commitment: 'confirmed' });
	// Once broadcast, an unknown outcome keeps the headroom claimed: releasing
	// it for a transfer that later lands would let the session overspend.
	let broadcast = false;
	try {
		const row = claim.row;
		if (!row.session_secret_enc) throw clientError('session_inactive', 'The session key has been destroyed; grant a new one.', 403);
		const delegateKp = Keypair.fromSecretKey(Buffer.from(await decryptSecret(row.session_secret_enc), 'base64'));
		if (delegateKp.publicKey.toBase58() !== row.session_pubkey) throw new Error('session key does not match its recorded delegate');
		const owner = new PublicKey(row.external_pubkey);
		const mintPk = new PublicKey(assetMint);
		const destPk = new PublicKey(dest);
		const programId = await tokenProgramOf(conn, assetMint);
		const fromAta = getAssociatedTokenAddressSync(mintPk, owner, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
		const toAta = getAssociatedTokenAddressSync(mintPk, destPk, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);

		const bh = await conn.getLatestBlockhash('confirmed');
		const message = new TransactionMessage({
			payerKey: delegateKp.publicKey,
			recentBlockhash: bh.blockhash,
			instructions: [
				createAssociatedTokenAccountIdempotentInstruction(delegateKp.publicKey, toAta, destPk, mintPk, programId, ASSOCIATED_TOKEN_PROGRAM_ID),
				createTransferCheckedInstruction(fromAta, mintPk, toAta, delegateKp.publicKey, amountRaw, decimals, [], programId),
			],
		}).compileToV0Message();
		const tx = new VersionedTransaction(message);
		tx.sign([delegateKp]);

		const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed' });
		if (sim?.value?.err) {
			throw clientError('simulation_failed', `The session transfer would fail on-chain: ${JSON.stringify(sim.value.err)}`, 422);
		}
		const signature = bs58.encode(tx.signatures[0]);
		await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
		broadcast = true;
		const confirmation = await pollConfirmation(conn, { signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
		if (confirmation?.value?.err) {
			broadcast = false;
			throw clientError('reverted', `The session transfer reverted: ${JSON.stringify(confirmation.value.err)}`, 422);
		}
		const custodyEventId = await recordCustodyEvent({
			agentId, userId, eventType: 'spend', category: 'transfer', network: net,
			asset: assetMint, amountRaw: amountRaw.toString(),
			usd: assetMint === USDC_MINT_BY_NETWORK[net] ? Number(amount) : null,
			destination: dest, signature, reason, status: 'confirmed',
			idempotencyKey: `session:${signature}`,
			meta: { signer: 'session', delegate: row.session_pubkey, owner: row.external_pubkey },
		});
		const remaining = BigInt(String(row.session_cap_raw)) - BigInt(String(row.session_spent_raw));
		return {
			signature,
			amount: Number(amount),
			amount_raw: amountRaw.toString(),
			destination: dest,
			mint: assetMint,
			network: net,
			custody_event_id: custodyEventId,
			session: { remaining_raw: (remaining > 0n ? remaining : 0n).toString() },
		};
	} catch (err) {
		if (!broadcast) await claim.release();
		throw err;
	}
}
