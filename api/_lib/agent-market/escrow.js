// Escrow custody for whole-agent marketplace bids.
//
// A bid is money in the listing's escrow account, never a promise. Two ways in:
//
//   agent_wallet      the platform signs a guarded USDC transfer from one of the
//                     bidder's own agents to escrow, under that agent's spend
//                     limits and kill switch, with a custody-event receipt
//                     (api/_lib/agent-usdc-transfer.js).
//   connected_wallet  the server prepares a transfer the bidder signs in their
//                     wallet; the platform marketplace payer is the fee payer
//                     and creates the escrow token account, so the bidder needs
//                     no SOL. A reference key rides the transfer; confirmation
//                     reads the landed transaction and checks the exact amount
//                     moved from the bidder's address into escrow.
//
// Two ways out: a refund to wherever the bid was funded from (rejected,
// withdrawn, expired, outbid on a closed listing), or the settlement legs in
// settlement.js. Both go through chain.js sendLeg, so neither can pay twice.

import { randomUUID } from 'node:crypto';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { sql } from '../db.js';
import { transferUsdcGuarded } from '../agent-usdc-transfer.js';
import { resolveMarketplacePayer } from '../solana/gasless-tx.js';
import {
	closeIx,
	currencyInfo,
	formatAtomics,
	marketConnection,
	marketNetwork,
	sendLeg,
	tokenBalance,
	tokenProgramFor,
	transferIxs,
	withEscrowKeypair,
} from './chain.js';

// Long enough to connect a wallet and approve; a prepared transaction's
// blockhash dies within ~90 seconds, so nothing signed can land after this.
export const FUND_WINDOW_MS = 10 * 60 * 1000;

function typed(status, code, message, extra = {}) {
	return Object.assign(new Error(message), { status, code, expose: true, ...extra });
}

// ── Funding: agent wallet ────────────────────────────────────────────────────

/**
 * Escrow a USDC bid from one of the bidder's agents. Synchronous: returns once
 * the transfer confirmed (or refused under the agent's spend policy).
 */
export async function fundFromAgentWallet({ bid, listing, fundingAgent }) {
	const usdc = Number(formatAtomics(bid.amount_atomics, 6));
	const result = await transferUsdcGuarded({
		fromAgentId: fundingAgent.id,
		fromUserId: fundingAgent.user_id,
		fromMeta: fundingAgent.meta,
		toAddress: listing.escrow_address,
		usdc,
		network: marketNetwork(),
		category: 'marketplace_bid',
		idempotencyKey: `agent-market-bid:${bid.id}`,
		rowMeta: { listing_id: listing.id, bid_id: bid.id, escrow: listing.escrow_address },
	});
	if (result.status === 'paid' || result.status === 'replayed') return { signature: result.signature };
	const messages = {
		wallet_frozen: 'That agent\'s wallet is frozen, so it cannot fund a bid. Unfreeze it under Limits & Safety or pay from a connected wallet.',
		daily_limit: 'This bid would exceed that agent\'s daily spend limit. Raise the limit or pay from a connected wallet.',
		per_tx_limit: 'This bid is above that agent\'s per-transaction limit. Raise the limit or pay from a connected wallet.',
		wallet_preparing: 'That agent has no Solana wallet yet.',
		send_failed: 'The escrow transfer could not be sent. Nothing left the wallet; check its USDC and SOL balance and try again.',
		unconfirmed: 'The escrow transfer was sent but has not confirmed yet. It will be picked up automatically once it lands.',
	};
	throw typed(
		result.status === 'blocked' ? 403 : 502,
		result.code || 'funding_failed',
		messages[result.code] || result.message || 'The escrow transfer failed.',
		{ signature: result.signature || null },
	);
}

/** Where an agent-wallet bid stands if the process died mid-transfer. */
export async function agentWalletFundingStatus(bid) {
	const [row] = await sql`
		SELECT status, signature FROM agent_custody_events
		WHERE agent_id = ${bid.funding_agent_id} AND idempotency_key = ${`agent-market-bid:${bid.id}`}
		LIMIT 1
	`;
	if (!row) return { state: 'none' };
	if (row.status === 'confirmed' && row.signature) return { state: 'landed', signature: row.signature };
	if (row.status === 'pending') return { state: 'pending', signature: row.signature || null };
	return { state: 'failed' };
}

// ── Funding: connected wallet ────────────────────────────────────────────────

export function newReference() {
	return Keypair.generate().publicKey.toBase58();
}

/**
 * Build the escrow transfer for the bidder to sign. With a marketplace payer
 * configured it is partially signed (the platform pays the fee and the escrow
 * account rent); without one the bidder is the fee payer.
 */
export async function buildFundingTransaction({ bid, listing }) {
	const connection = marketConnection();
	const info = currencyInfo(bid.currency);
	const programId = await tokenProgramFor(connection, info.mint);
	const payer = await resolveMarketplacePayer();
	const bidder = new PublicKey(bid.funding_address);
	const feePayer = payer ? payer.publicKey : bidder;
	const ixs = transferIxs({
		owner: bidder.toBase58(),
		recipient: listing.escrow_address,
		mint: info.mint,
		programId,
		decimals: info.decimals,
		atomics: BigInt(String(bid.amount_atomics)),
		rentPayer: feePayer.toBase58(),
		reference: new PublicKey(bid.escrow_reference),
	});
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const message = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
	const tx = new VersionedTransaction(message);
	if (payer) tx.sign([payer]);
	return {
		transaction: Buffer.from(tx.serialize()).toString('base64'),
		fee_payer: feePayer.toBase58(),
		gasless: Boolean(payer),
		last_valid_block_height: lastValidBlockHeight,
		reference: bid.escrow_reference,
		escrow_address: listing.escrow_address,
		network: marketNetwork(),
		mint: info.mint,
		amount: formatAtomics(bid.amount_atomics, info.decimals),
		currency: info.currency,
	};
}

/**
 * Find and verify the bidder's escrow transfer. Returns the signature when the
 * exact amount moved from the bidder's address into escrow in a landed,
 * successful transaction carrying the bid's reference key; null when nothing
 * has landed yet. Throws on a transaction that landed but does not match.
 */
export async function verifyConnectedFunding({ bid, listing, signature = null }) {
	const connection = marketConnection();
	const reference = new PublicKey(bid.escrow_reference);
	let sig = signature;
	if (!sig) {
		const found = await connection.getSignaturesForAddress(reference, { limit: 5 }, 'confirmed');
		sig = (found || []).find((s) => !s.err)?.signature || null;
		if (!sig) return null;
	}
	const tx = await connection.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
	if (!tx) return null;
	if (tx.meta?.err) throw typed(422, 'funding_reverted', 'That transaction failed on chain; no funds reached escrow.');

	const keys = tx.transaction.message.accountKeys.map((k) => (k.pubkey ? k.pubkey.toBase58() : String(k)));
	if (!keys.includes(reference.toBase58())) {
		throw typed(422, 'funding_mismatch', 'That transaction is not the escrow transfer for this bid.');
	}
	const info = currencyInfo(bid.currency);
	const delta = (owner) => {
		const pick = (list) => (list || []).find((b) => b.owner === owner && b.mint === info.mint);
		const pre = BigInt(pick(tx.meta.preTokenBalances)?.uiTokenAmount?.amount ?? '0');
		const post = BigInt(pick(tx.meta.postTokenBalances)?.uiTokenAmount?.amount ?? '0');
		return post - pre;
	};
	const want = BigInt(String(bid.amount_atomics));
	if (delta(listing.escrow_address) !== want || delta(bid.funding_address) !== -want) {
		throw typed(422, 'funding_mismatch', 'The escrow transfer amount or sender does not match this bid.');
	}
	return sig;
}

// ── Refunds and closure ──────────────────────────────────────────────────────

/**
 * Where a bid's refund goes: the connected wallet it came from, or the funding
 * agent's CURRENT wallet (an agent can rotate its key, e.g. a vanity swap, and
 * the old address may no longer be spendable).
 */
export async function refundDestination(bid) {
	if (bid.funding_source !== 'agent_wallet' || !bid.funding_agent_id) return bid.funding_address;
	const [agent] = await sql`
		SELECT user_id, meta->>'solana_address' AS address FROM agent_identities WHERE id = ${bid.funding_agent_id}
	`;
	if (agent?.address && agent.user_id === bid.bidder_user_id) return agent.address;
	return bid.funding_address;
}

/** Pay a bid's escrowed funds back. Exactly once; resumable. */
export async function refundBid({ bid, listing }) {
	const connection = marketConnection();
	const info = currencyInfo(bid.currency);
	const programId = await tokenProgramFor(connection, info.mint);
	const destination = await refundDestination(bid);
	return withEscrowKeypair(listing, (escrow) =>
		sendLeg({
			connection,
			legId: `refund:${bid.id}`,
			prior: bid.refund_leg,
			signers: [escrow],
			build: (reference, payer) =>
				transferIxs({
					owner: escrow.publicKey.toBase58(),
					recipient: destination,
					mint: info.mint,
					programId,
					decimals: info.decimals,
					atomics: BigInt(String(bid.amount_atomics)),
					rentPayer: payer.toBase58(),
					reference,
				}),
			onPrepared: async (rec) => {
				await sql`UPDATE agent_listing_bids SET refund_leg = ${JSON.stringify(rec)}::jsonb, updated_at = now() WHERE id = ${bid.id}`;
			},
		}).then((r) => ({ ...r, destination })),
	);
}

/**
 * Close a finished listing's escrow token accounts so their rent returns to
 * the marketplace payer. Only when every token account is empty: anything left
 * belongs to someone and stays until it is refunded.
 */
export async function closeEscrow(listing) {
	const connection = marketConnection();
	const payer = await resolveMarketplacePayer();
	if (!payer) return { closed: false, reason: 'fee_payer_unavailable' };
	const currencies = ['USDC', 'THREE'];
	const open = [];
	for (const currency of currencies) {
		const info = currencyInfo(currency);
		const programId = await tokenProgramFor(connection, info.mint);
		const ata = getAssociatedTokenAddressSync(new PublicKey(info.mint), new PublicKey(listing.escrow_address), true, programId);
		const acct = await connection.getAccountInfo(ata, 'confirmed');
		if (!acct) continue;
		const balance = await tokenBalance(connection, listing.escrow_address, info.mint, programId);
		if (balance > 0n) return { closed: false, reason: 'escrow_not_empty', currency, balance: balance.toString() };
		open.push({ info, programId });
	}
	if (!open.length) return { closed: true, signature: null };
	const { signature } = await withEscrowKeypair(listing, (escrow) =>
		sendLeg({
			connection,
			legId: `close:${listing.id}:${randomUUID()}`,
			signers: [escrow],
			build: () => open.map(({ info, programId }) =>
				closeIx({ owner: escrow.publicKey.toBase58(), mint: info.mint, programId, rentTo: payer.publicKey.toBase58() })),
			onPrepared: async () => {},
		}),
	);
	return { closed: true, signature };
}
