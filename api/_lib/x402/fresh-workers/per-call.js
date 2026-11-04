// api/_lib/x402/fresh-workers/per-call.js
//
// A one-shot payer for EVERY ring-tick call: each paid x402 call is signed by a
// wallet that never existed before, so on-chain and in x402scan each settlement
// is its own buyer and the accounting of "who bought what" is one wallet per
// transaction. Lifecycle per call, reusing the fresh-workers lane's rows,
// funding and sweep legs so reclaim, the leak scanner and the allowlist all
// cover these wallets with no extra wiring:
//
// The buyerFor hook mints and funds the wallet (SOL, ATA, that call's USDC).
// The afterPay hook books the result, confirms, sweeps and closes it.
//
// A wallet whose sweep does not land stays in x402_fresh_wallets in a
// reclaimable state; the fresh-workers tick's reclaim pass finishes it.
// buyerFor returns null when a wallet cannot be minted or funded, and the
// caller falls back to its shared payer so the ring never stalls.

import { Keypair, PublicKey } from '@solana/web3.js';

import { env } from '../../env.js';
import { logger } from '../../usage.js';
import { decodeSeedSecret, USDC_MINT } from '../pay.js';
import { freshWorkersConfig, walletSolLamports } from './plan.js';
import { mintWallet, markFunded, markFundFailed, markPaid, markPayFailed } from './wallets.js';
import { fundWallets, rentExemptLamports, confirmSignature } from './chain.js';
import { settleWallet } from './run.js';

const log = logger('x402-fresh-per-call');

const PAY_CONFIRM_MS = 15_000;

/** True when the ring tick should pay every call from a brand-new wallet. Off by default. */
export function freshPayerEnabled(e = process.env) {
	return String(e.X402_RING_FRESH_PAYER ?? '').trim().toLowerCase() === 'true';
}

function loadFunder(secret) {
	const bytes = decodeSeedSecret(secret);
	if (!bytes) return null;
	return Keypair.fromSecretKey(bytes);
}

/**
 * Resolve the two funders from env exactly as the fresh-workers lane does.
 * Returns { funders } or { reason } so the caller can log why it fell back.
 */
export function loadFreshFunders(e = process.env) {
	const treasurySecret = e.X402_TREASURY_SECRET_BASE58;
	const solFunderSecret = e.X402_FEE_PAYER_SECRET_BASE58 || treasurySecret;
	if (!treasurySecret) return { reason: 'treasury_secret_unset' };
	if (!e.WALLET_ENCRYPTION_KEY) return { reason: 'wallet_encryption_key_unset' };
	let treasury; let solFunder;
	try {
		treasury = loadFunder(treasurySecret);
		solFunder = loadFunder(solFunderSecret);
	} catch { return { reason: 'funder_secret_undecodable' }; }
	if (!treasury || !solFunder) return { reason: 'funder_secret_undecodable' };
	const payTo = env.X402_PAY_TO_SOLANA;
	if (payTo && treasury.publicKey.toBase58() !== payTo) return { reason: 'treasury_pubkey_mismatch' };
	return { funders: { treasury, solFunder } };
}

/**
 * Build the per-call payer for one tick.
 * @param {{ sql, conn, funders, runId: string, mintInfo: { decimals: number }, fundConfirmMs?: number }} p
 */
export async function createFreshCallPayer({ sql, conn, funders, runId, mintInfo, fundConfirmMs = 20_000 }) {
	const mint = new PublicKey(USDC_MINT);
	const decimals = mintInfo.decimals;
	const cfg = freshWorkersConfig();
	const solPerWallet = walletSolLamports({
		rentExemptLamports: await rentExemptLamports(conn),
		maxPayFeeLamports: cfg.maxPayFeeLamports,
	});
	const live = new Map(); // pubkey -> wallet row
	const stats = { minted: 0, fundFailed: 0, closed: 0, sweepFailed: 0 };

	async function buyerFor(ep, priceAtomic) {
		let w;
		try {
			w = await mintWallet({
				sql, mint, runId,
				job: { kind: 'ring', slug: String(ep.key || ep.path), title: String(ep.name || ep.key || ep.path) },
			});
		} catch (err) {
			log.warn('fresh_call_mint_failed', { message: err?.message });
			return null;
		}
		stats.minted += 1;
		const fund = await fundWallets({
			conn, solFunder: funders.solFunder, treasury: funders.treasury, mint, decimals,
			targets: [{ pubkey: w.keypair.publicKey, ata: new PublicKey(w.ata), solLamports: solPerWallet, usdcAtomic: BigInt(priceAtomic) }],
			confirmMs: fundConfirmMs,
		});
		if (!fund.ok) {
			stats.fundFailed += 1;
			await markFundFailed(sql, [w.id], `fund_failed:${fund.err}`).catch(() => {});
			log.warn('fresh_call_fund_failed', { pubkey: w.pubkey, err: fund.err });
			return null;
		}
		await markFunded(sql, [w.id], {
			fundSig: fund.signature, solLamports: solPerWallet, usdcAtomicById: new Map([[w.id, priceAtomic]]),
		});
		live.set(w.pubkey, w);
		return w.keypair;
	}

	async function afterPay(buyer, result) {
		const pubkey = buyer?.publicKey?.toBase58?.();
		const w = pubkey && live.get(pubkey);
		if (!w) return; // the shared fallback payer: nothing to close
		live.delete(pubkey);
		if (result?.success) {
			await markPaid(sql, w.id, { paySig: result.txSig, amountAtomic: result.paid ? result.amountAtomic : 0 });
		} else {
			await markPayFailed(sql, w.id, result?.errorMsg || `http_${result?.status ?? 0}`);
		}
		if (result?.txSig) await confirmSignature(conn, result.txSig, PAY_CONFIRM_MS);
		const done = await settleWallet({
			sql, conn, wallet: { id: w.id, pubkey: w.pubkey }, keypair: w.keypair, funders, mint, decimals, runId,
			confirmMs: 30_000,
		});
		if (done.state === 'closed') stats.closed += 1; else stats.sweepFailed += 1;
	}

	return { buyerFor, afterPay, stats };
}
