// api/_lib/x402/fresh-workers/chain.js
//
// The on-chain legs of a fresh worker wallet's life, as small effectful helpers
// over the shared connection + read guards: fund a batch of new wallets in one
// transaction, read a wallet's SOL/USDC, and sweep a wallet back to the funders
// while closing its token account so the rent it borrowed goes home.
//
// Invariants: every recipient is a funder or a fresh wallet this lane minted;
// USDC only ever moves treasury -> fresh -> treasury; SOL only ever moves
// funder -> fresh -> funder. Nothing here touches a wallet it did not create.

import {
	PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction,
	createCloseAccountInstruction,
	TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import { env } from '../../env.js';
import { blockhashKey, getRecentBlockhashInfo, readAccountInfoOrNull } from '../../solana/read-guards.js';
import { tokenAmountFromAccountData } from '../pipelines/ring-pool-fund.js';
import { ATA_RENT_LAMPORTS, BASE_FEE_LAMPORTS, RENT_EXEMPT_FALLBACK_LAMPORTS, sweepAmountLamports } from './plan.js';

// Compute-unit ceiling for the funding tx (a handful of transfers + ATA creates)
// and the sweep (one transfer, one close, one system transfer). Generous but far
// below the 1.4M default, so a tiny priority price stays a tiny fee.
const FUND_CU_LIMIT = 200_000;
const SWEEP_CU_LIMIT = 60_000;
// Lowest nonzero priority the funding tx pays so it lands promptly under load.
const FUND_PRIORITY_MICROLAMPORTS = 5;

export function usdcAtaOf(owner, mint) {
	return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

let _rentExempt = { value: null, at: 0 };
/** Rent-exempt minimum for a 0-byte account, read once an hour; constant fallback when RPC is dark. */
export async function rentExemptLamports(conn, now = Date.now()) {
	if (_rentExempt.value && now - _rentExempt.at < 3_600_000) return _rentExempt.value;
	try {
		const v = Number(await conn.getMinimumBalanceForRentExemption(0));
		if (Number.isFinite(v) && v > 0) {
			_rentExempt = { value: v, at: now };
			return v;
		}
	} catch { /* fall through to the constant */ }
	return _rentExempt.value || RENT_EXEMPT_FALLBACK_LAMPORTS;
}

export async function confirmSignature(conn, signature, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const st = await conn.getSignatureStatuses([signature]).catch(() => null);
		const v = st?.value?.[0];
		if (v?.err) return { confirmed: false, err: JSON.stringify(v.err) };
		if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return { confirmed: true };
		await new Promise((r) => setTimeout(r, 1200));
	}
	return { confirmed: false, err: 'timeout' };
}

async function sendIxs(conn, feePayer, signers, instructions, { confirmMs = 30_000 } = {}) {
	const { blockhash } = await getRecentBlockhashInfo(conn, blockhashKey({ url: env.SOLANA_RPC_URL }), { forceFresh: true });
	const msg = new TransactionMessage({ payerKey: feePayer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
	const vtx = new VersionedTransaction(msg);
	vtx.sign(signers);
	const signature = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false, maxRetries: 5 });
	const conf = await confirmSignature(conn, signature, confirmMs);
	return { ok: conf.confirmed, signature, err: conf.confirmed ? null : conf.err };
}

/** SOL balance in lamports (0 for a never-seen account), or null when unreadable. */
export async function readSolLamports(conn, pubkey) {
	const info = await readAccountInfoOrNull(conn, pubkey, { commitment: 'confirmed', withCause: true });
	if (info === null) return 0;
	if (info === undefined) return null;
	return Number(info.lamports || 0);
}

/** USDC held by an owner's ATA: { exists, atomic } or null when unreadable. */
export async function readUsdc(conn, ata) {
	const info = await readAccountInfoOrNull(conn, ata, { commitment: 'confirmed', withCause: true });
	if (info === null) return { exists: false, atomic: 0n };
	if (info === undefined) return null;
	return { exists: true, atomic: tokenAmountFromAccountData(info.data) };
}

/**
 * Fund every wallet in `targets` in ONE transaction: SOL from the funder, the
 * wallet's USDC ATA created (rent paid by the funder), and the job's USDC moved
 * from the treasury. Both funders sign; the treasury only as token authority.
 * @param {{ conn, solFunder, treasury, mint, decimals, targets: Array<{ pubkey: PublicKey, ata: PublicKey, solLamports: number, usdcAtomic: bigint }> }} p
 */
export async function fundWallets({ conn, solFunder, treasury, mint, decimals, targets, confirmMs }) {
	const treasuryAta = usdcAtaOf(treasury.publicKey, mint);
	const ixs = [
		ComputeBudgetProgram.setComputeUnitLimit({ units: FUND_CU_LIMIT }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: FUND_PRIORITY_MICROLAMPORTS }),
	];
	for (const t of targets) {
		ixs.push(SystemProgram.transfer({ fromPubkey: solFunder.publicKey, toPubkey: t.pubkey, lamports: t.solLamports }));
		ixs.push(createAssociatedTokenAccountIdempotentInstruction(
			solFunder.publicKey, t.ata, t.pubkey, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
		));
		if (t.usdcAtomic > 0n) {
			ixs.push(createTransferCheckedInstruction(
				treasuryAta, mint, t.ata, treasury.publicKey, t.usdcAtomic, decimals, [], TOKEN_PROGRAM_ID,
			));
		}
	}
	const signers = solFunder.publicKey.equals(treasury.publicKey) ? [solFunder] : [solFunder, treasury];
	return sendIxs(conn, solFunder, signers, ixs, { confirmMs });
}

/**
 * Empty a fresh wallet and close its token account in ONE self-paid
 * transaction: leftover USDC -> treasury, ATA rent -> the SOL funder, every
 * remaining lamport but the base fee -> the SOL funder. The wallet ends at
 * exactly zero. Returns what moved so the caller can book it.
 * @param {{ conn, wallet, solFunder: PublicKey, treasury: PublicKey, mint, decimals, confirmMs?: number }} p
 */
export async function sweepWallet({ conn, wallet, solFunder, treasury, mint, decimals, confirmMs }) {
	const owner = wallet.publicKey;
	const ata = usdcAtaOf(owner, mint);
	const [sol, usdc] = await Promise.all([readSolLamports(conn, owner), readUsdc(conn, ata)]);
	if (sol === null || usdc === null) return { ok: false, err: 'balance_unreadable' };
	if (sol === 0 && !usdc.exists) return { ok: true, signature: null, alreadyEmpty: true, solLamports: 0, usdcAtomic: 0n, rentLamports: 0 };
	if (sol < BASE_FEE_LAMPORTS) return { ok: false, err: `below_sweep_fee:${sol}` };

	const ixs = [
		ComputeBudgetProgram.setComputeUnitLimit({ units: SWEEP_CU_LIMIT }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
	];
	if (usdc.exists) {
		if (usdc.atomic > 0n) {
			const treasuryAta = usdcAtaOf(treasury, mint);
			ixs.push(createTransferCheckedInstruction(ata, mint, treasuryAta, owner, usdc.atomic, decimals, [], TOKEN_PROGRAM_ID));
		}
		// closeAccount: [account, rent destination, authority]. The funder paid the
		// rent when it created the account, so the funder gets it back.
		ixs.push(createCloseAccountInstruction(ata, solFunder, owner, [], TOKEN_PROGRAM_ID));
	}
	const send = sweepAmountLamports({ balanceLamports: sol, feeLamports: BASE_FEE_LAMPORTS });
	if (send > 0) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: solFunder, lamports: send }));

	const res = await sendIxs(conn, wallet, [wallet], ixs, { confirmMs });
	if (!res.ok) return { ok: false, signature: res.signature, err: res.err };
	return {
		ok: true,
		signature: res.signature,
		solLamports: send,
		usdcAtomic: usdc.exists ? usdc.atomic : 0n,
		// USDC is a classic SPL account, so its rent is the fixed classic figure
		// (the same constant the facilitator books when it creates one).
		rentLamports: usdc.exists ? ATA_RENT_LAMPORTS : 0,
	};
}

export { PublicKey };
