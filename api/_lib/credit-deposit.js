// Verify an on-chain SOL, USDC or $THREE transfer into the platform deposit
// wallet and credit the depositor's prepaid balance (api/_lib/credits.js).
//
// Trust model (server-authoritative — a client "I paid" claim is never trusted):
//   1. The transaction is confirmed and didn't error on-chain.
//   2. A SIGNER of the transaction is a Solana wallet linked to the authenticated
//      user — binds the deposit to the right account and stops anyone from
//      claiming someone else's transfer by pasting its signature.
//   3. The platform deposit wallet actually received funds — computed from pre/post
//      balances (lamport delta for SOL, token-balance delta for $THREE), robust to
//      a destination ATA created within the same transaction and to which transfer
//      variant was used.
//   4. The credit is idempotent per (tx signature, asset) via a UNIQUE
//      idempotency_key, so the same deposit can never be credited twice — while a
//      single tx carrying both SOL and $THREE still credits each asset once.
//   5. Credits settle only once the tx is FINALIZED (rooted); a confirmed-but-not
//      -finalized tx returns a retryable `pending` result so a reorg can never
//      credit a deposit that later disappears.
//
// Deposited funds land in the treasury / x402 receive wallet — the platform's
// prepaid float. Spending credits is internal ledger accounting; the treasury →
// buyback / holder-reflection loop runs from there (see token/config.js economy
// note). Deposits are therefore NOT split on receipt.

import { solanaConnection } from './solana/connection.js';
import { sql } from './db.js';
import { env } from './env.js';
import { creditAccount } from './credits.js';
import {
	TOKEN_MINT,
	TOKEN_DECIMALS,
	TOKEN_SYMBOL,
	treasuryWalletOrNull,
	creditBonusBps,
} from './token/config.js';
import { getTokenPriceUsd } from './token/price.js';
import { solanaMintUsdPrice } from './balances.js';
import { USDC_CREDIT_RATE } from './pricing/catalog.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

// Circle's USDC mints per cluster (same table api/_lib/agent-usdc-transfer.js
// pays from). Devnet is only reachable outside production, see network below.
const USDC_MINT_BY_NETWORK = Object.freeze({
	mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
});
const USDC_DECIMALS = 6;

export const DEPOSIT_ASSETS = Object.freeze(['SOL', 'USDC', 'THREE']);

/**
 * Every asset the deposit wallet accepts, with how each one is priced. This is
 * the single source the /api/credits payload and the deposit verifier share, so
 * the credits page can only ever advertise an asset the verifier will credit.
 * `rate.kind` is `fixed` (usd_per_unit is the published rate) or `live_price`
 * (the mainnet quote at verification time). `bonus_bps` is extra credit on top
 * of the USD value, from owner policy (THREE_CREDIT_BONUS_BPS); 0 means none.
 * @param {'mainnet'|'devnet'} [network]
 */
export function depositAssetCatalog(network = 'mainnet') {
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	return [
		{
			asset: 'SOL',
			label: 'SOL',
			mint: SOL_MINT,
			decimals: 9,
			native: true,
			rate: { kind: 'live_price', source: 'mainnet quote at verification' },
			bonus_bps: 0,
		},
		{
			asset: 'USDC',
			label: 'USDC',
			mint: USDC_MINT_BY_NETWORK[net],
			decimals: USDC_DECIMALS,
			native: false,
			rate: { kind: 'fixed', usd_per_unit: USDC_CREDIT_RATE, source: 'published rate' },
			bonus_bps: 0,
		},
		{
			asset: 'THREE',
			label: TOKEN_SYMBOL,
			mint: TOKEN_MINT,
			decimals: TOKEN_DECIMALS,
			native: false,
			rate: { kind: 'live_price', source: 'mainnet quote at verification' },
			bonus_bps: creditBonusBps(),
		},
	];
}

/**
 * The single Solana address users send deposits to. Defaults to the existing x402
 * Solana receive wallet (then the treasury) so a working deploy needs no new env;
 * set CREDITS_DEPOSIT_WALLET_SOLANA to route deposits to a dedicated wallet.
 */
export function depositWallet() {
	return (
		(process.env.CREDITS_DEPOSIT_WALLET_SOLANA || '').trim() ||
		env.X402_PAY_TO_SOLANA ||
		treasuryWalletOrNull() ||
		null
	);
}

function rpcUrl(network) {
	return network === 'devnet'
		? env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

function depositError(message, status = 422, code = 'deposit_unverified', extra = {}) {
	return Object.assign(new Error(message), { status, code, ...extra });
}

function isSolAddress(s) {
	return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/** Set of Solana addresses linked to a user (user_wallets + legacy wallet_address). */
export async function linkedSolanaWallets(user) {
	const rows = await sql`
		select address from user_wallets where user_id = ${user.id} and chain_type = 'solana'
	`;
	const set = new Set(rows.map((r) => r.address));
	if (user.wallet_address && isSolAddress(user.wallet_address)) set.add(user.wallet_address);
	return set;
}

function accountKeyStr(k) {
	return k?.pubkey?.toString?.() || String(k?.pubkey ?? '');
}

/** Signers of a parsed transaction, as base58 strings. */
function signerSet(tx) {
	const keys = tx.transaction?.message?.accountKeys || [];
	const out = new Set();
	for (const k of keys) if (k.signer) out.add(accountKeyStr(k));
	return out;
}

// Net SPL atomics credited to `owner` for `mint`, from pre/post token balances.
function tokenCreditedTo(tx, { mint, owner }) {
	const pre = tx.meta?.preTokenBalances || [];
	const post = tx.meta?.postTokenBalances || [];
	let delta = 0n;
	for (const p of post) {
		if (p.mint !== mint || p.owner !== owner) continue;
		const before = pre.find((x) => x.accountIndex === p.accountIndex);
		delta +=
			BigInt(p.uiTokenAmount?.amount ?? '0') - BigInt(before?.uiTokenAmount?.amount ?? '0');
	}
	return delta;
}

// Net lamports credited to `owner`, from pre/post native balances (index-aligned
// with accountKeys in a parsed transaction).
function lamportsCreditedTo(tx, owner) {
	const keys = tx.transaction?.message?.accountKeys || [];
	const idx = keys.findIndex((k) => accountKeyStr(k) === owner);
	if (idx < 0) return 0n;
	const pre = BigInt(tx.meta?.preBalances?.[idx] ?? 0);
	const post = BigInt(tx.meta?.postBalances?.[idx] ?? 0);
	return post - pre;
}

/**
 * Verify a deposit transaction and credit the user's prepaid balance.
 * @param {{ user: object, asset: 'SOL'|'USDC'|'THREE', txSignature: string, network?: string }} args
 * @returns {Promise<object>} credit result for the API response
 */
export async function verifyAndCreditDeposit({ user, asset, txSignature, network: requestedNetwork = 'mainnet' }) {
	// Devnet only outside production. Credits are priced at the mainnet SOL and
	// $THREE price and spend as real USDC through /api/pay/execute, so accepting a
	// faucet-funded devnet transfer minted real money from nothing. Same rule as
	// api/payments/solana/[action].js.
	const network = requestedNetwork === 'devnet' && process.env.NODE_ENV !== 'production' ? 'devnet' : 'mainnet';
	const sink = depositWallet();
	if (!sink)
		throw depositError('the deposit wallet is not configured', 503, 'deposit_unavailable');

	const assetU = String(asset || '').toUpperCase();
	if (!DEPOSIT_ASSETS.includes(assetU))
		throw depositError(`asset must be one of ${DEPOSIT_ASSETS.join(', ')}`, 400, 'bad_request');
	if (typeof txSignature !== 'string' || txSignature.length < 32 || txSignature.length > 128) {
		throw depositError('a valid tx_signature is required', 400, 'bad_request');
	}

	const connection = solanaConnection({ url: rpcUrl(network), commitment: 'confirmed' });

	// Credits settle only on a FINALIZED (rooted) transaction. A merely
	// "confirmed" tx can still be dropped by a chain reorg, which would credit a
	// deposit that later vanishes. getParsedTransaction at finalized commitment
	// returns the tx only once it is rooted; until then we report a retryable
	// `pending` result so the client polls instead of seeing a spurious error.
	let tx;
	try {
		tx = await connection.getParsedTransaction(txSignature, {
			maxSupportedTransactionVersion: 1,
			commitment: 'finalized',
		});
	} catch {
		tx = null;
	}
	if (!tx) {
		// Not finalized yet, or genuinely unknown. Check the signature status to
		// tell "confirmed, still finalizing" (keep polling) apart from "failed"
		// and "not found" (stop).
		let status = null;
		try {
			const { value } = await connection.getSignatureStatuses([txSignature], {
				searchTransactionHistory: true,
			});
			status = value?.[0] || null;
		} catch {
			status = null;
		}
		if (status?.err) throw depositError('transaction failed on-chain', 422, 'tx_failed');
		if (status && status.confirmationStatus !== 'finalized') {
			return {
				ok: false,
				pending: true,
				status: 'awaiting_finalization',
				confirmation_status: status.confirmationStatus || 'processed',
				tx_signature: txSignature,
				message:
					'Confirmed on-chain — finalizing. This takes a few seconds, then your credits land automatically.',
			};
		}
		throw depositError(
			'transaction not found — it may need more confirmations',
			422,
			'tx_not_found',
		);
	}
	if (tx.meta?.err) throw depositError('transaction failed on-chain', 422, 'tx_failed');

	// Bind the deposit to the authenticated user: a signer must be one of their
	// linked Solana wallets.
	const linked = await linkedSolanaWallets(user);
	const matched = [...signerSet(tx)].find((s) => linked.has(s));
	if (!matched) {
		throw depositError(
			'this transfer was not signed by a wallet linked to your account — sign in with the sending wallet, or link it, then retry',
			403,
			'wallet_not_linked',
		);
	}

	let usd;
	let assetAmount;
	let priceUsd;
	let amount; // human units, for display
	if (assetU === 'SOL') {
		const lamports = lamportsCreditedTo(tx, sink);
		if (lamports <= 0n) {
			throw depositError(
				'no SOL was received at the deposit wallet in this transaction',
				422,
				'no_funds_received',
			);
		}
		priceUsd = await solanaMintUsdPrice(SOL_MINT);
		if (!(priceUsd > 0))
			throw depositError(
				'live SOL price unavailable — try again shortly',
				503,
				'price_unavailable',
			);
		assetAmount = lamports;
		amount = Number(lamports) / LAMPORTS_PER_SOL;
		usd = amount * priceUsd;
	} else if (assetU === 'USDC') {
		// USDC is credited at the published fixed rate (pricing/catalog.js), never
		// a quote: credits are USD-denominated and 1 USDC is $1.00 of credits.
		const atomics = tokenCreditedTo(tx, { mint: USDC_MINT_BY_NETWORK[network], owner: sink });
		if (atomics <= 0n) {
			throw depositError(
				'no USDC was received at the deposit wallet in this transaction',
				422,
				'no_funds_received',
			);
		}
		priceUsd = USDC_CREDIT_RATE;
		assetAmount = atomics;
		amount = Number(atomics) / 10 ** USDC_DECIMALS;
		usd = amount * priceUsd;
	} else {
		const atomics = tokenCreditedTo(tx, { mint: TOKEN_MINT, owner: sink });
		if (atomics <= 0n) {
			throw depositError(
				'no $THREE was received at the deposit wallet in this transaction',
				422,
				'no_funds_received',
			);
		}
		const p = await getTokenPriceUsd();
		priceUsd = p.priceUsd;
		assetAmount = atomics;
		amount = Number(atomics) / 10 ** TOKEN_DECIMALS;
		usd = amount * priceUsd;
	}

	usd = Math.round(usd * 1e6) / 1e6;
	if (!(usd > 0))
		throw depositError(
			'deposit amount rounds to zero at the current price',
			422,
			'amount_too_small',
		);

	// Idempotency is per (signature, asset): one transaction can carry both SOL
	// and $THREE to the deposit wallet, and each asset is credited once. Legacy
	// deposits were keyed on the signature alone (`deposit:<sig>`), so if such a
	// row already exists we reuse that key — re-verifying an old deposit resolves
	// to a replay instead of double-crediting under the new per-asset key.
	const legacyKey = `deposit:${txSignature}`;
	const [priorLegacy] = await sql`
		select 1 from credit_ledger where idempotency_key = ${legacyKey} limit 1
	`;
	const idempotencyKey = priorLegacy ? legacyKey : `deposit:${assetU}:${txSignature}`;

	const res = await creditAccount({
		userId: user.id,
		amountUsd: usd,
		kind: 'deposit',
		refType: `deposit_${assetU.toLowerCase()}`,
		refId: txSignature,
		txSignature,
		asset: assetU,
		assetAmount,
		priceUsd,
		idempotencyKey,
		meta: { slot: tx.slot ?? null, signer: matched, amount, network },
	});

	// Paying in $THREE earns the owner-configured bonus as a separate `grant`
	// row on the same ledger, keyed on the deposit so a re-verify replays it
	// instead of granting twice. The bonus is read at credit time, so a policy
	// change applies to the next deposit and never rewrites an old one.
	const bonusBps = assetU === 'THREE' ? creditBonusBps() : 0;
	let bonusUsd = 0;
	let balanceUsd = res.balanceUsd;
	if (bonusBps > 0) {
		bonusUsd = Math.round(usd * bonusBps) / 10_000;
		bonusUsd = Math.round(bonusUsd * 1e6) / 1e6;
		if (bonusUsd > 0) {
			const bonus = await creditAccount({
				userId: user.id,
				amountUsd: bonusUsd,
				kind: 'grant',
				action: 'deposit.three_bonus',
				refType: 'deposit_three_bonus',
				refId: txSignature,
				txSignature,
				asset: assetU,
				assetAmount: 0n,
				priceUsd,
				idempotencyKey: `${idempotencyKey}:bonus`,
				meta: { bonus_bps: bonusBps, base_usd: usd, network },
			});
			balanceUsd = bonus.balanceUsd;
			if (bonus.replay) bonusUsd = 0;
		}
	}

	return {
		ok: true,
		replay: res.replay,
		balance_usd: balanceUsd,
		credited_usd: res.replay ? 0 : usd,
		bonus_usd: res.replay ? 0 : bonusUsd,
		bonus_bps: bonusBps,
		usd,
		asset: assetU,
		amount,
		price_usd: priceUsd,
		tx_signature: txSignature,
	};
}
