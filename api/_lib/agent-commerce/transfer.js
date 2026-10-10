// The one place the commerce layer moves money: an agent-signed SOL or SPL
// transfer from the agent's own custodial wallet, run through the platform
// spend guard first and the protected submit path after.
//
// Order is load-bearing:
//   1. reserveSpendUsd claims the USD headroom atomically (freeze, destination
//      allowlist, policy rules, per-transaction and daily caps, anomaly guard).
//      It runs BEFORE the key is touched, so a refused spend never decrypts a
//      secret.
//   2. The keypair is recovered, which refuses an agent in external or session
//      signing mode (assertPlatformSigningAllowed).
//   3. The transfer is built with the optional Solana Pay reference as a
//      read-only account and the optional memo, then sent through
//      submitProtected (simulated compute budget, priority fee, rebroadcast,
//      hard throw on revert).
//   4. The reservation is finalized with the signature, or released when the
//      money never moved.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
} from '@solana/spl-token';
import { solanaConnection } from '../solana/connection.js';
import { submitProtected } from '../execution-engine.js';
import { loadBuyerAgentKeypair } from '../agent-purchase.js';
import {
	SOL_FEE_HEADROOM_LAMPORTS, ATA_RENT_LAMPORTS, SpendLimitError,
	reserveSpendUsd, releaseSpendReservation, updateCustodyEvent,
} from '../agent-trade-guards.js';
import { MEMO_PROGRAM_ID, MEMO_MAX_BYTES, associatedTokenAddress, resolveMint } from '../custody/builders.js';
import { CommerceError, assetSpec, atomicsToUsd, formatAtomics } from './assets.js';

/**
 * Lamports and token balance the agent wallet needs before a transfer is
 * attempted, so a short wallet gets a plain message instead of a simulation
 * error.
 */
async function assertFunded({ connection, owner, spec, atomics, mintInfo }) {
	const lamports = BigInt(await connection.getBalance(owner, 'confirmed'));
	const feeNeed = SOL_FEE_HEADROOM_LAMPORTS + (spec.native ? 0n : ATA_RENT_LAMPORTS);
	if (spec.native) {
		if (lamports < atomics + feeNeed) {
			throw new CommerceError(
				'insufficient_balance',
				`The agent wallet holds ${formatAtomics(lamports, 9)} SOL; this send needs ${formatAtomics(atomics, 9)} SOL plus about ${formatAtomics(feeNeed, 9)} SOL for fees.`,
				402,
				{ balance: formatAtomics(lamports, 9), needed: formatAtomics(atomics + feeNeed, 9) },
			);
		}
		return;
	}
	const ata = associatedTokenAddress(new PublicKey(spec.mint), owner, mintInfo.programId, 'sender');
	let held = 0n;
	try {
		held = BigInt((await connection.getTokenAccountBalance(ata, 'confirmed')).value.amount);
	} catch {
		held = 0n;
	}
	if (held < atomics) {
		throw new CommerceError(
			'insufficient_balance',
			`The agent wallet holds ${formatAtomics(held, spec.decimals)} ${spec.symbol}; this needs ${formatAtomics(atomics, spec.decimals)}.`,
			402,
			{ balance: formatAtomics(held, spec.decimals), needed: formatAtomics(atomics, spec.decimals) },
		);
	}
	if (lamports < feeNeed) {
		throw new CommerceError(
			'insufficient_sol_for_fees',
			`The agent wallet needs about ${formatAtomics(feeNeed, 9)} SOL for network fees and the recipient's token account; it holds ${formatAtomics(lamports, 9)} SOL.`,
			402,
		);
	}
}

function buildInstructions({ from, to, spec, atomics, mintInfo, reference, memo }) {
	const ixs = [];
	let transferIx;
	if (spec.native) {
		transferIx = SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: atomics });
	} else {
		const mint = new PublicKey(spec.mint);
		const fromAta = associatedTokenAddress(mint, from, mintInfo.programId, 'sender');
		const toAta = associatedTokenAddress(mint, to, mintInfo.programId, 'recipient');
		ixs.push(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint, mintInfo.programId));
		// TransferChecked: Token-2022 mints ($THREE among them) reject the unchecked variant.
		transferIx = createTransferCheckedInstruction(fromAta, mint, toAta, from, atomics, mintInfo.decimals, [], mintInfo.programId);
	}
	// The Solana Pay reference rides as a read-only, non-signer account so the
	// payee finds this exact transfer with getSignaturesForAddress(reference).
	if (reference) transferIx.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false });
	ixs.push(transferIx);
	if (memo) {
		if (Buffer.byteLength(memo, 'utf8') > MEMO_MAX_BYTES) throw new CommerceError('invalid_memo', `memo must be at most ${MEMO_MAX_BYTES} bytes`);
		ixs.push(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(memo, 'utf8') }));
	}
	return ixs;
}

/**
 * Send `atomics` of `asset` from the agent's wallet to `recipient`.
 *
 * @param {object} o
 * @param {string} o.agentId
 * @param {string} o.userId                 the agent's owner (already authorized by the caller)
 * @param {'mainnet'|'devnet'} o.network
 * @param {'USDC'|'SOL'|'THREE'} o.asset
 * @param {string} o.recipient              base58 Solana address
 * @param {bigint} o.atomics
 * @param {string} o.category               spend-ledger category ('transfer', 'purchase')
 * @param {string|null} [o.reference]       Solana Pay reference key
 * @param {string|null} [o.memo]
 * @param {'system'|null} [o.destinationTrust]  set only by server code for a destination it resolved itself
 * @param {boolean} [o.stepUpApproved]      the owner approved this exact spend in the approval inbox
 * @param {object} [o.rowMeta]              extra fields for the custody ledger row
 * @returns {Promise<{ signature: string, usd: number|null, amount: string, network: string, asset: string, recipient: string, reservationId: string }>}
 */
export async function agentTransfer({
	agentId, userId, network, asset, recipient, atomics, category,
	reference = null, memo = null, destinationTrust = null, stepUpApproved = false, rowMeta = {},
}) {
	const spec = assetSpec(asset, network);
	const amount = BigInt(atomics);
	if (amount <= 0n) throw new CommerceError('invalid_amount', 'amount must be greater than zero');

	const usd = await atomicsToUsd(spec.asset, amount, spec.decimals);
	if (usd == null && network === 'mainnet') {
		// The daily cap is denominated in USD. Sending blind would let an outage
		// in the price feed walk straight past it, so a mainnet send waits.
		throw new CommerceError('price_unavailable', `No live ${spec.symbol} price right now, so the spend limit cannot be checked. Try again in a minute.`, 503);
	}

	const { reservationId } = await reserveSpendUsd({
		agentId,
		userId,
		category,
		usdValue: usd ?? 0,
		destination: recipient,
		network,
		asset: spec.symbol,
		destinationTrust,
		stepUpApproved,
		rowMeta: {
			...rowMeta,
			asset: spec.asset,
			mint: spec.mint,
			amount: formatAtomics(amount, spec.decimals),
			amount_atomics: amount.toString(),
			reference: reference || undefined,
			memo: memo || undefined,
			source: 'agent_commerce',
		},
	});

	let signature = null;
	try {
		const connection = solanaConnection({ network });
		const { keypair } = await loadBuyerAgentKeypair({ agentId, userId, reason: `agent_commerce_${category}` });
		const to = new PublicKey(recipient);
		if (to.equals(keypair.publicKey)) throw new CommerceError('invalid_recipient', 'an agent cannot pay its own wallet');
		const mintInfo = spec.native ? null : await resolveMint(connection, new PublicKey(spec.mint));
		if (mintInfo && mintInfo.decimals !== spec.decimals) {
			throw new CommerceError('mint_mismatch', `${spec.symbol} on ${network} reports ${mintInfo.decimals} decimals, expected ${spec.decimals}.`, 409);
		}
		await assertFunded({ connection, owner: keypair.publicKey, spec, atomics: amount, mintInfo });
		const instructions = buildInstructions({ from: keypair.publicKey, to, spec, atomics: amount, mintInfo, reference, memo });
		({ signature } = await submitProtected({ network, connection, payer: keypair, instructions }));
	} catch (err) {
		await releaseSpendReservation(reservationId, `agent_commerce_${category}_failed`).catch(() => {});
		if (err instanceof CommerceError || err instanceof SpendLimitError) throw err;
		if (err?.status === 409 && err?.code === 'platform_signing_disabled') {
			throw new CommerceError('platform_signing_disabled', err.message, 409);
		}
		throw new CommerceError('transfer_failed', `The transfer did not go through: ${(err?.message || 'unknown error').slice(0, 200)}`, 502);
	}

	await updateCustodyEvent(reservationId, { status: 'confirmed', signature, usd: usd ?? undefined, meta: { settled_at: new Date().toISOString() } });
	return {
		signature,
		usd,
		amount: formatAtomics(amount, spec.decimals),
		network,
		asset: spec.asset,
		recipient,
		reservationId,
	};
}
