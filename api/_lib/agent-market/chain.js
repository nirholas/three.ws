// On-chain primitives for the whole-agent marketplace: per-listing escrow
// accounts, currency mints, and the exactly-once "leg" sender every escrow
// payout, refund and custody sweep goes through.
//
// Escrow. Each listing gets its own Solana account whose keypair is derived, not
// stored: seed = HMAC-SHA256(AGENT_MARKET_ESCROW_SECRET, domain + listingId). The
// secret falls back to WALLET_ENCRYPTION_KEY (the custody root, which is already
// never rotated because rotating it bricks every custodial wallet) and never to
// JWT_SECRET. The derived address is stored on the listing at creation and
// re-derived before every signature: a mismatch means the secret changed, and
// signing then fails closed instead of moving money from the wrong account.
// Escrow accounts hold no SOL; the platform marketplace payer (the monitored
// `marketplace-payer` signer in api/_lib/solana-signers.js) pays every fee and
// every token-account rent, and gets the rent back when an escrow empties.
//
// Legs. A payout that crashes between broadcast and bookkeeping must not be paid
// twice on resume, and a resend while the first attempt might still land would
// do exactly that. So a leg is signed locally, its signature and the blockhash's
// last valid height are persisted through `onPrepared` BEFORE broadcast, and a
// resume reconciles against that record: landed means done, reverted or expired
// means resend, still-valid-and-unknown means wait. Every leg also carries a
// deterministic reference key, so even a lost record is recoverable by looking
// the reference up on chain.

import { createHash, createHmac } from 'node:crypto';
import {
	ComputeBudgetProgram,
	Keypair,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createCloseAccountInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';

import { env } from '../env.js';
import { solanaConnection } from '../agent-pumpfun.js';
import { pollConfirmation } from '../solana/confirm.js';
import { resolveMarketplacePayer } from '../solana/gasless-tx.js';
import { tokenProgramIdForMint } from '../token/token-program.js';
import { TOKEN_MINT, TOKEN_DECIMALS } from '../token/config.js';

const ESCROW_DOMAIN = 'three.ws:agent-market-escrow:v1:';
const REFERENCE_DOMAIN = 'three.ws:agent-market-leg:v1:';

export const USDC_DECIMALS = 6;
const USDC_MINT_BY_NETWORK = {
	mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

// A marketplace transfer is a handful of instructions; 200k CU is a ceiling, not
// an estimate, and the price is a modest fixed bid: settlement is not a race.
const LEG_CU_LIMIT = 300_000;
const LEG_CU_PRICE_MICROLAMPORTS = 50_000;

export function marketNetwork() {
	return env.AGENT_MARKET_NETWORK === 'devnet' ? 'devnet' : 'mainnet';
}

export function marketConnection() {
	return solanaConnection(marketNetwork());
}

function typed(status, code, message) {
	return Object.assign(new Error(message), { status, code, expose: true });
}

// ── Currencies ───────────────────────────────────────────────────────────────

/** Mint, decimals and display symbol for a marketplace currency. */
export function currencyInfo(currency, network = marketNetwork()) {
	if (currency === 'THREE') {
		return { currency: 'THREE', symbol: '$THREE', mint: TOKEN_MINT, decimals: Number(TOKEN_DECIMALS) };
	}
	return { currency: 'USDC', symbol: 'USDC', mint: USDC_MINT_BY_NETWORK[network], decimals: USDC_DECIMALS };
}

/** Decimal string for display, never float-rounded. */
export function formatAtomics(atomics, decimals) {
	const v = BigInt(String(atomics));
	const neg = v < 0n;
	const abs = neg ? -v : v;
	const base = 10n ** BigInt(decimals);
	const whole = abs / base;
	const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Parse a decimal amount into atomics without float error. Throws 400 on junk. */
export function parseAmount(value, decimals) {
	const s = String(value ?? '').trim();
	if (!/^\d+(\.\d+)?$/.test(s)) throw typed(400, 'bad_amount', `"${value}" is not a positive amount`);
	const [whole, frac = ''] = s.split('.');
	if (frac.length > decimals) throw typed(400, 'bad_amount', `at most ${decimals} decimal places`);
	const atomics = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
	if (atomics <= 0n) throw typed(400, 'bad_amount', 'amount must be greater than zero');
	return atomics;
}

export async function tokenProgramFor(connection, mint) {
	return tokenProgramIdForMint(connection, mint);
}

// ── Escrow derivation ────────────────────────────────────────────────────────

function escrowSecret() {
	const secret = env.AGENT_MARKET_ESCROW_SECRET;
	if (!secret) {
		throw typed(503, 'escrow_unavailable', 'marketplace escrow is not configured on this server');
	}
	return secret;
}

function deriveEscrowKeypair(listingId) {
	const seed = createHmac('sha256', escrowSecret()).update(ESCROW_DOMAIN + listingId).digest();
	return Keypair.fromSeed(seed);
}

/** The escrow address for a listing. Public; safe to log and return. */
export function escrowAddressFor(listingId) {
	return deriveEscrowKeypair(listingId).publicKey.toBase58();
}

/**
 * Hand the listing's escrow keypair to `fn` after proving it still derives to
 * the address recorded at listing time. `fn` must not let the keypair escape.
 */
export async function withEscrowKeypair(listing, fn) {
	const kp = deriveEscrowKeypair(listing.id);
	if (kp.publicKey.toBase58() !== listing.escrow_address) {
		throw typed(
			503,
			'escrow_key_mismatch',
			'the escrow secret no longer derives this listing\'s escrow account; refusing to sign',
		);
	}
	return fn(kp);
}

/** Deterministic reference key for one leg, e.g. `refund:<bidId>`. */
export function legReference(legId) {
	return new PublicKey(createHash('sha256').update(REFERENCE_DOMAIN + legId).digest());
}

async function requirePayer() {
	const payer = await resolveMarketplacePayer();
	if (!payer) {
		throw typed(503, 'fee_payer_unavailable', 'the marketplace fee payer is not configured on this server');
	}
	return payer;
}

// ── Token movement instructions ──────────────────────────────────────────────

/**
 * Instructions that move `atomics` of `mint` from `owner`'s ATA to
 * `recipient`'s ATA, creating the recipient's account if needed (rent from
 * `rentPayer`). The reference key rides the transfer.
 */
export function transferIxs({ owner, recipient, mint, programId, decimals, atomics, rentPayer, reference }) {
	const mintPk = new PublicKey(mint);
	const ownerPk = new PublicKey(owner);
	const recipientPk = new PublicKey(recipient);
	const fromAta = getAssociatedTokenAddressSync(mintPk, ownerPk, true, programId);
	const toAta = getAssociatedTokenAddressSync(mintPk, recipientPk, true, programId);
	const transfer = createTransferCheckedInstruction(
		fromAta, mintPk, toAta, ownerPk, BigInt(atomics), decimals, [], programId,
	);
	if (reference) transfer.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
	return [
		createAssociatedTokenAccountIdempotentInstruction(
			new PublicKey(rentPayer), toAta, recipientPk, mintPk, programId,
		),
		transfer,
	];
}

/** Close `owner`'s token account for `mint`, returning its rent to `rentTo`. */
export function closeIx({ owner, mint, programId, rentTo }) {
	const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, programId);
	return createCloseAccountInstruction(ata, new PublicKey(rentTo), new PublicKey(owner), [], programId);
}

/** Current token balance of `owner`'s ATA for `mint` (atomics), 0n when absent. */
export async function tokenBalance(connection, owner, mint, programId) {
	const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, programId);
	try {
		const bal = await connection.getTokenAccountBalance(ata, 'confirmed');
		return BigInt(bal?.value?.amount ?? '0');
	} catch (err) {
		if (/could not find account|Invalid param: could not find/i.test(err?.message || '')) return 0n;
		throw err;
	}
}

// ── Exactly-once legs ────────────────────────────────────────────────────────

/**
 * Where a previously prepared leg stands on chain.
 * @returns {Promise<'landed'|'failed'|'in_flight'|'expired'>}
 */
export async function reconcileLeg(connection, prior) {
	if (!prior?.signature) return 'expired';
	let status = null;
	try {
		const res = await connection.getSignatureStatuses([prior.signature], { searchTransactionHistory: true });
		status = res?.value?.[0] ?? null;
	} catch {
		// An unreadable chain is not an answer: treat it as in flight so the
		// caller waits instead of resending into a possible double pay.
		return 'in_flight';
	}
	if (status) {
		if (status.err) return 'failed';
		if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return 'landed';
		return 'in_flight';
	}
	let height;
	try {
		height = await connection.getBlockHeight('confirmed');
	} catch {
		return 'in_flight';
	}
	return height > Number(prior.lastValidBlockHeight) ? 'expired' : 'in_flight';
}

/** A successful transaction that already carries this leg's reference, if any. */
export async function findLandedByReference(connection, reference) {
	const sigs = await connection.getSignaturesForAddress(reference, { limit: 10 }, 'confirmed');
	const ok = (sigs || []).find((s) => !s.err);
	return ok ? ok.signature : null;
}

/**
 * Send one leg exactly once.
 *
 * @param {object} a
 * @param {string} a.legId                   stable id, e.g. `payout:<transferId>`
 * @param {(ref: PublicKey) => import('@solana/web3.js').TransactionInstruction[]} a.build
 *        instructions for the leg; attach `ref` to a transfer so it is findable
 * @param {import('@solana/web3.js').Keypair[]} a.signers  authorities beside the fee payer
 * @param {{signature:string,lastValidBlockHeight:number}|null} a.prior  record from an earlier attempt
 * @param {(rec: {signature:string,lastValidBlockHeight:number}) => Promise<void>} a.onPrepared
 *        persist the record; called before broadcast, and the leg aborts if it throws
 * @returns {Promise<{ signature: string, replayed: boolean }>}
 */
export async function sendLeg({ legId, build, signers, prior = null, onPrepared, connection = marketConnection() }) {
	const reference = legReference(legId);

	if (prior?.signature) {
		const state = await reconcileLeg(connection, prior);
		if (state === 'landed') return { signature: prior.signature, replayed: true };
		if (state === 'in_flight') {
			throw typed(409, 'leg_in_flight', `a previous attempt of ${legId} may still land; retry after its blockhash expires`);
		}
	}
	const landed = await findLandedByReference(connection, reference).catch(() => null);
	if (landed) return { signature: landed, replayed: true };

	const payer = await requirePayer();
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const message = new TransactionMessage({
		payerKey: payer.publicKey,
		recentBlockhash: blockhash,
		instructions: [
			ComputeBudgetProgram.setComputeUnitLimit({ units: LEG_CU_LIMIT }),
			ComputeBudgetProgram.setComputeUnitPrice({ microLamports: LEG_CU_PRICE_MICROLAMPORTS }),
			...build(reference, payer.publicKey),
		],
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);
	tx.sign([payer, ...signers]);
	const signature = bs58.encode(tx.signatures[0]);

	// Simulate before recording: a leg that cannot succeed (empty escrow, frozen
	// account) should fail loudly now, not after a record that implies it flew.
	const sim = await connection.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed' });
	if (sim?.value?.err) {
		const logs = (sim.value.logs || []).slice(-4).join(' | ');
		throw typed(502, 'leg_simulation_failed', `${legId} would fail on chain: ${JSON.stringify(sim.value.err)} ${logs}`.slice(0, 480));
	}

	await onPrepared({ signature, lastValidBlockHeight });

	const raw = tx.serialize();
	await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
	// Rebroadcast until it lands or the blockhash dies: a single send is dropped
	// often enough under load that settlement would stall on it.
	const rebroadcast = setInterval(() => {
		connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
	}, 2_000);
	try {
		const result = await pollConfirmation(connection, { signature, blockhash, lastValidBlockHeight }, 'confirmed', {
			timeoutMs: 90_000,
		});
		if (result?.value?.err) {
			throw typed(502, 'leg_reverted', `${legId} reverted on chain: ${JSON.stringify(result.value.err)}`);
		}
	} finally {
		clearInterval(rebroadcast);
	}
	return { signature, replayed: false };
}

export { TOKEN_PROGRAM_ID };
