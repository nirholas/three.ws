// Platform trading fee for pump.fun buys and sells routed through three.ws.
//
// Every trade the platform builds (buy-prep / sell-prep) can carry a platform
// fee that matches pump.fun's own trade-fee rate. The fee is a REAL on-chain
// transfer appended to the SAME transaction the user signs — native SOL for
// SOL-paired trades, the quote SPL token (USDC) for USDC-paired trades — sent
// to the platform fee wallet. There is no second signature and no custody: the
// user signs one transaction that does the swap and pays the fee atomically.
//
// Honesty (Rule 1 & 9): the fee is never hidden. prep responses surface a
// `platform_fee` block and the trade UI shows a fee line. The fee applies only
// when BOTH a recipient wallet is configured AND the rate is > 0 — so an
// unconfigured environment (local/preview without a fee wallet) charges nothing
// automatically, which makes flow-testing safe without code changes.
//
// Basis:
//   buy  → fee on the quote amount spent (charged on top of the trade).
//   sell → fee on the expected quote proceeds (taken from the proceeds).

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { SOLANA_USDC_MINT, SOLANA_USDC_MINT_DEVNET } from '../payments/_config.js';
import { resolveSignerPubkey } from './solana-signers.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Hard ceiling — a guard so a fat-fingered env can never charge an absurd fee.
const MAX_FEE_BPS = 500; // 5%

/**
 * The platform trade-fee rate in basis points. Defaults to 0 (OFF) so the fee
 * ships inert and never activates on deploy by surprise — set
 * PUMP_PLATFORM_FEE_BPS=100 to charge 1% (matching pump.fun's trade fee) once
 * trading has been verified. Clamped to [0, MAX_FEE_BPS]. The fee also requires
 * a configured recipient (pumpFeeRecipient), so both knobs must be set to bill.
 * @returns {number}
 */
export function pumpPlatformFeeBps() {
	const raw = process.env.PUMP_PLATFORM_FEE_BPS;
	const n = raw == null || String(raw).trim() === '' ? 0 : parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(n, MAX_FEE_BPS);
}

/**
 * The launch-fee rate in basis points: charged on the dev buy of a coin
 * launched through three.ws, on top of pump.fun's own fees. Defaults to 100
 * (1%), the rate the owner set for the launchpad; PUMP_LAUNCH_FEE_BPS=0 turns
 * it off. Clamped to [0, MAX_FEE_BPS]. Like the trade fee it only bills when a
 * recipient wallet resolves, and a launch with no dev buy pays nothing.
 * @returns {number}
 */
export function pumpLaunchFeeBps() {
	const raw = process.env.PUMP_LAUNCH_FEE_BPS;
	const n = raw == null || String(raw).trim() === '' ? 100 : parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(n, MAX_FEE_BPS);
}

/**
 * The fee rate that will ACTUALLY be charged right now: the configured bps when
 * a recipient wallet is set, otherwise 0. Quote/UI surfaces use this so the
 * displayed "Platform fee X%" never claims a fee the transaction won't take.
 * @returns {Promise<number>}
 */
export async function effectivePumpFeeBps() {
	const bps = pumpPlatformFeeBps();
	if (bps <= 0) return 0;
	return (await pumpFeeRecipient()) ? bps : 0;
}

let _recipientCache = null; // { at, pubkey }
const RECIPIENT_TTL_MS = 60_000;

/**
 * The fee recipient. An explicit PUMP_PLATFORM_FEE_WALLET base58 address wins;
 * otherwise we derive the platform treasury keypair's public key (no secret is
 * exposed — only the pubkey). Returns null when neither is configured, which
 * disables the fee (fail-open to no-charge, never break a trade over fee setup).
 * @returns {Promise<PublicKey|null>}
 */
export async function pumpFeeRecipient() {
	if (_recipientCache && Date.now() - _recipientCache.at < RECIPIENT_TTL_MS) {
		return _recipientCache.pubkey;
	}
	let pubkey = null;
	const explicit = (process.env.PUMP_PLATFORM_FEE_WALLET || '').trim();
	if (explicit) {
		try { pubkey = new PublicKey(explicit); } catch { pubkey = null; }
	}
	if (!pubkey) {
		const r = await resolveSignerPubkey({
			env: 'PLATFORM_TREASURY_KEYPAIR',
			fallbackEnv: 'TREASURY_KEYPAIR',
		});
		if (r.pubkey) {
			try { pubkey = new PublicKey(r.pubkey); } catch { pubkey = null; }
		}
	}
	_recipientCache = { at: Date.now(), pubkey };
	return pubkey;
}

/**
 * Fee in atomic units of the quote asset: floor(gross * bps / 10_000).
 * @param {bigint|number|string} grossAtomics
 * @param {number} [bps]
 * @returns {bigint}
 */
export function pumpFeeAtomics(grossAtomics, bps = pumpPlatformFeeBps()) {
	let g;
	try {
		g = typeof grossAtomics === 'bigint' ? grossAtomics : BigInt(String(grossAtomics ?? '0').split('.')[0]);
	} catch {
		return 0n;
	}
	if (g <= 0n || bps <= 0) return 0n;
	return (g * BigInt(bps)) / 10_000n;
}

/**
 * Build the platform-fee transfer instruction(s) to append to a trade tx, plus
 * a disclosure block for the prep response. Returns null when no fee applies
 * (rate 0, no recipient configured, or a sub-atomic fee).
 *
 * @param {object} o
 * @param {string} o.network            'mainnet' | 'devnet'
 * @param {PublicKey|string} o.payer    the trader's wallet (and fee source)
 * @param {boolean} o.isUsdc            true for USDC/SPL-quoted trades
 * @param {PublicKey|string} [o.quoteMintPk]      the quote mint (USDC trades)
 * @param {PublicKey} [o.quoteTokenProgram]       the quote mint's token program
 * @param {bigint|number|string} o.grossAtomics   quote spend (buy) / proceeds (sell)
 * @param {number} [o.bps]              rate override (the launch fee); defaults to the trade fee
 * @returns {Promise<{ instructions: import('@solana/web3.js').TransactionInstruction[],
 *   disclosure: { bps:number, asset:'SOL'|'USDC', amount:string, amount_ui:number,
 *                 recipient:string, basis:string } } | null>}
 */
export async function buildPlatformFeeInstructions({
	network,
	payer,
	isUsdc,
	quoteMintPk,
	quoteTokenProgram,
	grossAtomics,
	basis = 'trade',
	bps = pumpPlatformFeeBps(),
}) {
	const fee = pumpFeeAtomics(grossAtomics, bps);
	if (fee <= 0n) return null;

	const recipient = await pumpFeeRecipient();
	if (!recipient) return null;

	const payerPk = payer instanceof PublicKey ? payer : new PublicKey(payer);

	if (!isUsdc) {
		const ix = SystemProgram.transfer({
			fromPubkey: payerPk,
			toPubkey: recipient,
			lamports: fee,
		});
		return {
			instructions: [ix],
			disclosure: {
				bps,
				asset: 'SOL',
				amount: fee.toString(),
				amount_ui: Number(fee) / 1e9,
				recipient: recipient.toBase58(),
				basis,
			},
		};
	}

	// USDC (or other SPL quote): move the fee from the trader's quote ATA to the
	// recipient's, creating the recipient ATA idempotently so a first-ever fee
	// always lands. The trader funds the (tiny) ATA rent only on first creation.
	const spl = await import('@solana/spl-token');
	const mintPk = quoteMintPk instanceof PublicKey
		? quoteMintPk
		: new PublicKey(quoteMintPk || (network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT));
	const tokenProgram = quoteTokenProgram instanceof PublicKey ? quoteTokenProgram : spl.TOKEN_PROGRAM_ID;
	const payerAta = spl.getAssociatedTokenAddressSync(mintPk, payerPk, true, tokenProgram);
	const recipientAta = spl.getAssociatedTokenAddressSync(mintPk, recipient, true, tokenProgram);
	const instructions = [
		spl.createAssociatedTokenAccountIdempotentInstruction(payerPk, recipientAta, recipient, mintPk, tokenProgram),
		spl.createTransferInstruction(payerAta, recipientAta, payerPk, fee, [], tokenProgram),
	];
	return {
		instructions,
		disclosure: {
			bps,
			asset: 'USDC',
			amount: fee.toString(),
			amount_ui: Number(fee) / 1e6,
			recipient: recipient.toBase58(),
			basis,
		},
	};
}

/**
 * Did a confirmed, parsed transaction deliver a disclosed platform fee? Reads
 * the recipient's balance delta from the transaction's own meta (lamports for
 * SOL, the quote mint's token balance for SPL), so a transaction assembled
 * outside three.ws without the fee transfer is caught at confirm time.
 *
 * @param {object} tx          getParsedTransaction result
 * @param {{ asset:'SOL'|'USDC', amount:string, recipient:string }} fee
 * @param {string} [quoteMint] the SPL quote mint for USDC fees
 * @returns {boolean}
 */
export function txPaidPlatformFee(tx, fee, quoteMint) {
	if (!fee) return true;
	const want = BigInt(fee.amount || '0');
	if (want <= 0n) return true;
	const meta = tx?.meta;
	if (!meta) return false;
	if (fee.asset === 'SOL') {
		const keys = tx.transaction.message.accountKeys.map((k) => String(k.pubkey || k));
		const i = keys.indexOf(fee.recipient);
		if (i < 0) return false;
		return BigInt(meta.postBalances[i] ?? 0) - BigInt(meta.preBalances[i] ?? 0) >= want;
	}
	const sum = (rows) =>
		(rows || [])
			.filter((b) => b.owner === fee.recipient && (!quoteMint || b.mint === quoteMint))
			.reduce((acc, b) => acc + BigInt(b.uiTokenAmount?.amount || '0'), 0n);
	return sum(meta.postTokenBalances) - sum(meta.preTokenBalances) >= want;
}

export { WSOL_MINT, MAX_FEE_BPS };
