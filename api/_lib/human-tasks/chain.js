// On-chain escrow for human tasks.
//
// Each task gets its own Solana account whose keypair is derived, never stored:
// seed = HMAC-SHA256(secret, domain + taskId). The secret is
// HUMAN_TASK_ESCROW_SECRET, falling back to the marketplace escrow secret (and
// through it to WALLET_ENCRYPTION_KEY, the custody root that is never rotated).
// The derived address is stored on the task at post time and re-derived before
// every signature: a mismatch means the secret changed, and signing fails
// closed instead of moving money from the wrong account.
//
// Escrow accounts hold no SOL. The platform marketplace payer pays every fee
// and token-account rent and gets the rent back when the escrow closes. Every
// payout, fee and refund goes through the marketplace's exactly-once leg sender
// (api/_lib/agent-market/chain.js sendLeg), so a crash between broadcast and
// bookkeeping resumes instead of paying twice.

import { createHmac } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { env } from '../env.js';
import { solanaConnection } from '../agent-pumpfun.js';
import { resolveMarketplacePayer } from '../solana/gasless-tx.js';
import {
	closeIx,
	currencyInfo,
	sendLeg,
	tokenBalance,
	tokenProgramFor,
	transferIxs,
} from '../agent-market/chain.js';

const ESCROW_DOMAIN = 'three.ws:human-task-escrow:v1:';

export const USDC_DECIMALS = 6;

function typed(status, code, message) {
	return Object.assign(new Error(message), { status, code, expose: true });
}

export function taskNetwork() {
	return process.env.HUMAN_TASKS_NETWORK === 'devnet' ? 'devnet' : 'mainnet';
}

export function taskConnection(network = taskNetwork()) {
	return solanaConnection(network);
}

export function usdcMint(network = taskNetwork()) {
	return currencyInfo('USDC', network).mint;
}

function escrowSecret() {
	const secret = process.env.HUMAN_TASK_ESCROW_SECRET || env.AGENT_MARKET_ESCROW_SECRET;
	if (!secret) throw typed(503, 'escrow_unavailable', 'Human-task escrow is not configured on this server.');
	return secret;
}

function deriveEscrowKeypair(taskId) {
	const seed = createHmac('sha256', escrowSecret()).update(ESCROW_DOMAIN + taskId).digest();
	return Keypair.fromSeed(seed);
}

/** The escrow address for a task. Public; safe to log and return. */
export function escrowAddressFor(taskId) {
	return deriveEscrowKeypair(taskId).publicKey.toBase58();
}

/** Run `fn` with the task's escrow keypair after proving it still derives to the stored address. */
export async function withEscrowKeypair(task, fn) {
	const kp = deriveEscrowKeypair(task.id);
	if (kp.publicKey.toBase58() !== task.escrow_address) {
		throw typed(503, 'escrow_key_mismatch', 'The escrow secret no longer derives this task\'s escrow account; refusing to sign.');
	}
	return fn(kp);
}

/** Is `address` a wallet (on-curve) Solana public key? A PDA cannot sign, so it is refused as a payout target. */
export function isSolanaAddress(address) {
	if (typeof address !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
	try {
		return PublicKey.isOnCurve(new PublicKey(address).toBytes());
	} catch {
		return false;
	}
}

/**
 * Move `atomics` USDC out of a task's escrow to `recipient`, exactly once.
 * `legId` names the leg (payout:<id>, fee:<id>, refund:<id>); `prior` is the
 * record an earlier attempt persisted; `onPrepared` persists the new record
 * before broadcast.
 */
export async function sendFromEscrow({ task, legId, recipient, atomics, prior, onPrepared }) {
	const connection = taskConnection(task.network);
	const mint = usdcMint(task.network);
	const programId = await tokenProgramFor(connection, mint);
	return withEscrowKeypair(task, (escrow) =>
		sendLeg({
			connection,
			legId,
			prior,
			signers: [escrow],
			build: (reference, payer) =>
				transferIxs({
					owner: escrow.publicKey.toBase58(),
					recipient,
					mint,
					programId,
					decimals: USDC_DECIMALS,
					atomics: BigInt(String(atomics)),
					rentPayer: payer.toBase58(),
					reference,
				}),
			onPrepared,
		}),
	);
}

/** USDC currently held in a task's escrow (atomics). */
export async function escrowBalance(task) {
	const connection = taskConnection(task.network);
	const mint = usdcMint(task.network);
	const programId = await tokenProgramFor(connection, mint);
	return tokenBalance(connection, task.escrow_address, mint, programId);
}

/**
 * Close a finished task's empty escrow token account so its rent returns to
 * the marketplace payer. Leaves anything non-empty alone: it belongs to someone.
 */
export async function closeTaskEscrow(task) {
	const connection = taskConnection(task.network);
	const payer = await resolveMarketplacePayer();
	if (!payer) return { closed: false, reason: 'fee_payer_unavailable' };
	const mint = usdcMint(task.network);
	const programId = await tokenProgramFor(connection, mint);
	const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(task.escrow_address), true, programId);
	const acct = await connection.getAccountInfo(ata, 'confirmed');
	if (!acct) return { closed: true, signature: null };
	const balance = await tokenBalance(connection, task.escrow_address, mint, programId);
	if (balance > 0n) return { closed: false, reason: 'escrow_not_empty', balance: balance.toString() };
	const { signature } = await withEscrowKeypair(task, (escrow) =>
		sendLeg({
			connection,
			legId: `close:${task.id}`,
			signers: [escrow],
			build: () => [closeIx({ owner: escrow.publicKey.toBase58(), mint, programId, rentTo: payer.publicKey.toBase58() })],
			onPrepared: async () => {},
		}),
	);
	return { closed: true, signature };
}
