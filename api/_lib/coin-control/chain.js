// Coin Control: the on-chain half of a coin's fee engine.
//
//   fetchEligibleHolders  the coin's top holders that can receive a reward
//   boughtTokens          how many tokens a confirmed buy delivered to the agent
//   burnAgentTokens       destroy tokens the agent wallet holds (SPL burnChecked)
//   airdropSol            SOL to many holders from the agent wallet, in chunks,
//                         each chunk metered by the same spend guards as any send
//
// Every send reserves its USD against the agent's spend policy before the key is
// loaded, and releases the reservation when the money never moved. The burn moves
// no value to anyone, so it has no reservation; the leg that calls it records the
// signature on the run receipt.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createBurnCheckedInstruction } from '@solana/spl-token';
import { solanaConnection } from '../solana/connection.js';
import { submitProtected } from '../execution-engine.js';
import { loadBuyerAgentKeypair } from '../agent-purchase.js';
import {
	SOL_FEE_HEADROOM_LAMPORTS, reserveSpendUsd, releaseSpendReservation, updateCustodyEvent,
} from '../agent-trade-guards.js';
import { MEMO_PROGRAM_ID, associatedTokenAddress, resolveMint } from '../custody/builders.js';
import { composeTokenHolders, rankHolders } from '../crypto-token-holders.js';
import { cachedSolUsd } from '../trader-stats.js';
import { eligibleHolders, HOLDER_POOL_SIZE, lamportsToSolString, tokenDeltaFromMeta } from './core.js';

/** Recipients per airdrop transaction: twenty transfers would overflow the 1232-byte packet. */
export const AIRDROP_CHUNK = 10;

const isWallet = (owner) => {
	try {
		return PublicKey.isOnCurve(new PublicKey(owner).toBytes());
	} catch {
		return false;
	}
};

async function rankedHolders(mint, network) {
	if (network === 'mainnet') {
		const r = await composeTokenHolders({ address: mint, limit: HOLDER_POOL_SIZE });
		if (r.status === 'not_found') throw Object.assign(new Error('The coin mint was not found on chain.'), { code: 'mint_not_found' });
		if (r.status !== 'ok') throw Object.assign(new Error('The holder list is unavailable right now, so no reward was sent.'), { code: 'holders_unavailable' });
		return r.top;
	}
	// Devnet: the keyless path only. The largest accounts, owners resolved in one read.
	const connection = solanaConnection({ network });
	const mintPk = new PublicKey(mint);
	const [largest, supply] = await Promise.all([
		connection.getTokenLargestAccounts(mintPk, 'confirmed'),
		connection.getTokenSupply(mintPk, 'confirmed'),
	]);
	const accounts = largest.value.map((a) => ({ address: a.address.toBase58(), amount: a.amount }));
	const parsed = await connection.getMultipleParsedAccounts(largest.value.map((a) => a.address), { commitment: 'confirmed' });
	parsed.value.forEach((v, i) => {
		const owner = v?.data?.parsed?.info?.owner;
		if (owner) accounts[i].owner = owner;
	});
	return rankHolders(accounts, supply.value.amount, HOLDER_POOL_SIZE);
}

/**
 * The coin's top holders that can receive a reward, largest first.
 * @param {{ mint: string, network: 'mainnet'|'devnet', exclude?: string[] }} o
 */
export async function fetchEligibleHolders({ mint, network, exclude = [] }) {
	const ranked = await rankedHolders(mint, network);
	return eligibleHolders(ranked, { exclude, isWallet });
}

/**
 * Raw token units the agent wallet gained in a confirmed transaction. The
 * transaction can take a few seconds to become readable after confirmation, so
 * this polls the chain with backoff before giving up.
 */
export async function boughtTokens({ network, signature, owner, mint, tries = 6 }) {
	const connection = solanaConnection({ network });
	let wait = 1000;
	for (let i = 0; i < tries; i++) {
		const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
		if (tx?.meta) {
			if (tx.meta.err) throw Object.assign(new Error('The buy transaction failed on chain, so there is nothing to burn.'), { code: 'buy_failed' });
			return tokenDeltaFromMeta(tx.meta, owner, mint);
		}
		await new Promise((r) => setTimeout(r, wait));
		wait = Math.min(wait * 2, 8000);
	}
	throw Object.assign(new Error('The buy confirmed, but its transaction could not be read yet, so the burn waits for the next settle pass.'), { code: 'tx_unreadable' });
}

/**
 * Burn tokens of `mint` from the agent wallet: exactly what the buy with
 * signature `buySignature` delivered (read from the confirmed transaction), or
 * `amountRaw` when given. Never burns more than the wallet holds, so tokens the
 * agent held before the buy are untouched.
 * @returns {Promise<{ signature: string, burned: bigint, bought: bigint|null, decimals: number }>}
 */
export async function burnAgentTokens({ agentId, userId, network, mint, amountRaw = null, buySignature = null }) {
	const connection = solanaConnection({ network });
	const mintPk = new PublicKey(mint);
	const { keypair } = await loadBuyerAgentKeypair({ agentId, userId, reason: 'coin_control_burn' });
	const bought = buySignature
		? await boughtTokens({ network, signature: buySignature, owner: keypair.publicKey.toBase58(), mint })
		: null;
	const want = bought ?? BigInt(amountRaw ?? 0);
	if (want <= 0n) throw Object.assign(new Error('The buy delivered no tokens to the agent wallet, so nothing was burned.'), { code: 'nothing_to_burn' });
	const mintInfo = await resolveMint(connection, mintPk);
	const ata = associatedTokenAddress(mintPk, keypair.publicKey, mintInfo.programId, 'owner');
	let held = 0n;
	try {
		held = BigInt((await connection.getTokenAccountBalance(ata, 'confirmed')).value.amount);
	} catch {
		held = 0n;
	}
	const amount = want < held ? want : held;
	if (amount <= 0n) throw Object.assign(new Error('The agent wallet holds none of this coin, so nothing was burned.'), { code: 'nothing_to_burn' });
	const ix = createBurnCheckedInstruction(ata, mintPk, keypair.publicKey, amount, mintInfo.decimals, [], mintInfo.programId);
	const { signature } = await submitProtected({ network, connection, payer: keypair, instructions: [ix] });
	return { signature, burned: amount, bought, decimals: mintInfo.decimals };
}

/** A recent blockhash, the public half of a lottery seed. */
export async function recentBlockhash(network) {
	const { blockhash } = await solanaConnection({ network }).getLatestBlockhash('finalized');
	return blockhash;
}

function memoIx(text, signer) {
	return new TransactionInstruction({
		programId: MEMO_PROGRAM_ID,
		keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
		data: Buffer.from(text, 'utf8'),
	});
}

/**
 * Send SOL to every recipient from the agent wallet, AIRDROP_CHUNK per
 * transaction. Each chunk reserves its own USD against the spend policy, so a
 * cap hit mid-way stops cleanly with the earlier chunks recorded as sent.
 *
 * @param {{ agentId: string, userId: string, network: string,
 *           recipients: Array<{ owner: string, lamports: bigint }>, memo: string,
 *           rowMeta?: object, stepUpApproved?: boolean }} o
 * @returns {Promise<{ sent: Array<{ owner: string, lamports: string, signature: string }>,
 *                     failed: Array<{ owner: string, lamports: string, error: string, code?: string }>,
 *                     signatures: string[] }>}
 */
export async function airdropSol({ agentId, userId, network, recipients, memo, rowMeta = {}, stepUpApproved = false }) {
	const connection = solanaConnection({ network });
	const { keypair } = await loadBuyerAgentKeypair({ agentId, userId, reason: 'coin_control_holder_rewards' });
	const total = recipients.reduce((a, r) => a + BigInt(r.lamports), 0n);
	const balance = BigInt(await connection.getBalance(keypair.publicKey, 'confirmed'));
	const chunks = [];
	for (let i = 0; i < recipients.length; i += AIRDROP_CHUNK) chunks.push(recipients.slice(i, i + AIRDROP_CHUNK));
	const feeNeed = SOL_FEE_HEADROOM_LAMPORTS * BigInt(chunks.length);
	if (balance < total + feeNeed) {
		throw Object.assign(
			new Error(`The agent wallet holds ${lamportsToSolString(balance)} SOL; the rewards need ${lamportsToSolString(total)} SOL plus about ${lamportsToSolString(feeNeed)} SOL in fees.`),
			{ code: 'insufficient_balance' },
		);
	}
	const solUsd = network === 'mainnet' ? await cachedSolUsd().catch(() => null) : null;
	if (network === 'mainnet' && !solUsd) {
		throw Object.assign(new Error('No live SOL price right now, so the spend limit cannot be checked. Nothing was sent.'), { code: 'price_unavailable' });
	}

	const sent = [];
	const failed = [];
	const signatures = [];
	for (let c = 0; c < chunks.length; c++) {
		const chunk = chunks[c];
		const lamports = chunk.reduce((a, r) => a + BigInt(r.lamports), 0n);
		const usd = solUsd ? (Number(lamports) / 1e9) * solUsd : 0;
		let reservationId = null;
		try {
			({ reservationId } = await reserveSpendUsd({
				agentId, userId, category: 'transfer', usdValue: usd, destination: null, network, asset: 'SOL',
				destinationTrust: 'system', stepUpApproved,
				rowMeta: { ...rowMeta, action: 'holder_rewards', chunk: c, recipients: chunk.map((r) => ({ owner: r.owner, lamports: String(r.lamports) })) },
			}));
			const ixs = chunk.map((r) => SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(r.owner), lamports: BigInt(r.lamports) }));
			if (memo) ixs.push(memoIx(memo.slice(0, 80), keypair.publicKey));
			const { signature } = await submitProtected({ network, connection, payer: keypair, instructions: ixs });
			signatures.push(signature);
			for (const r of chunk) sent.push({ owner: r.owner, lamports: String(r.lamports), signature });
			// The SOL has moved: a ledger write that fails now must not release the
			// reservation, or the spend would vanish from the daily cap.
			await updateCustodyEvent(reservationId, { status: 'confirmed', signature, usd, meta: { settled_at: new Date().toISOString() } })
				.catch((e) => console.error('[coin-control] custody update failed after airdrop', signature, e?.message));
		} catch (err) {
			if (reservationId) await releaseSpendReservation(reservationId, 'holder_rewards_failed').catch(() => {});
			const error = String(err?.message || err).slice(0, 240);
			// One failed chunk stops the rest: a cap or policy that refused this one
			// would refuse the next, and a half-sent pot is easier to explain than a
			// scattered one.
			for (const r of chunks.slice(c).flat()) failed.push({ owner: r.owner, lamports: String(r.lamports), error, code: err?.code });
			break;
		}
	}
	return { sent, failed, signatures };
}
