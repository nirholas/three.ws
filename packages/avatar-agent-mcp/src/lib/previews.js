// Spend-nothing previews for the four value-moving tools.
//
// Each preview reads the same live state the executing tool will read (the
// signer's balance, a Jupiter quote, the creator-fee vault) and runs the same
// policy checks (spend cap, recipient allowlist, tip clamp), but never builds a
// signed transaction. What it returns is exactly what a person needs to approve
// the real call: who pays, who receives, how much, and whether it would be
// refused. A refusal is reported in `blockers`, never thrown, so the preview can
// always be shown.

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

import { getConnection, isValidPubkey, keypairFromSecret, loadSigner } from './solana.js';
import { fetchJupiterQuote } from './jupiter-buy.js';
import {
	MAX_SOL_PER_TX,
	RECIPIENT_ALLOWLIST,
	RENT_EXEMPT_LAMPORTS,
	clampJitoTipSol,
	clampPriorityMicroLamports,
	enforceMinBuffer,
} from './spend-policy.js';

// Base fee per signature plus the compute-unit price the tools pay. The unit
// limits match what each signing lib sets on its transactions.
const BASE_FEE_LAMPORTS = 5000;
// Headroom the launch and collect libs require the funder to hold on top of
// the tip, for the fees of their bundle transactions.
const BUNDLE_FEE_HEADROOM_SOL = 0.002;

const toSol = (lamports) => Number(lamports) / LAMPORTS_PER_SOL;

function priorityFeeLamports(microLamports, units) {
	return Math.ceil((clampPriorityMicroLamports(microLamports) * units) / 1_000_000);
}

function capBlocker(sol, label) {
	return Number(sol) > MAX_SOL_PER_TX
		? { code: 'over_spend_cap', message: `${label}: ${sol} SOL exceeds the per-tx cap of ${MAX_SOL_PER_TX} SOL.` }
		: null;
}

function allowlistBlocker(pubkey, label) {
	if (!RECIPIENT_ALLOWLIST || RECIPIENT_ALLOWLIST.has(String(pubkey))) return null;
	return { code: 'recipient_not_allowed', message: `${label} ${pubkey} is not in RECIPIENT_ALLOWLIST.` };
}

async function balanceLamports(pubkey) {
	return getConnection().getBalance(new PublicKey(pubkey), 'confirmed');
}

/** Resolve a signer's public key without keeping the keypair around. */
function signerAddress(secret, fallbackToEnv) {
	const kp = fallbackToEnv ? loadSigner(secret) : keypairFromSecret(secret);
	return kp.publicKey.toBase58();
}

/** wallet_send: sender, recipient, amount, fee, and the balance left after. */
export async function previewWalletSend({ secret, to, sol, priorityMicroLamports = 100000 }) {
	const blockers = [];
	if (!isValidPubkey(to)) blockers.push({ code: 'invalid_destination', message: `Not a valid Solana pubkey: ${to}` });
	const amount = Number(sol);
	if (!(amount > 0)) blockers.push({ code: 'invalid_amount', message: 'sol must be greater than zero.' });
	const cap = capBlocker(amount, 'wallet_send');
	if (cap) blockers.push(cap);
	const allow = isValidPubkey(to) ? allowlistBlocker(to, 'wallet_send destination') : null;
	if (allow) blockers.push(allow);

	const from = signerAddress(secret, true);
	const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
	const fee = BASE_FEE_LAMPORTS + priorityFeeLamports(priorityMicroLamports, 1000);
	const balance = await balanceLamports(from);
	if (balance < lamports + fee) {
		blockers.push({
			code: 'insufficient_funds',
			message: `Sender holds ${toSol(balance)} SOL; this send needs ${toSol(lamports + fee)} SOL including fees.`,
		});
	}
	return {
		action: 'wallet_send',
		chain: 'solana-mainnet',
		token: 'SOL',
		from,
		to,
		amount_sol: amount,
		network_fee_sol: toSol(fee),
		sender_balance_sol: toSol(balance),
		sender_balance_after_sol: toSol(balance - lamports - fee),
		spend_cap_sol: MAX_SOL_PER_TX,
		would_execute: blockers.length === 0,
		blockers,
	};
}

/** pump_buy: a live Jupiter quote for the exact SOL amount and slippage. */
export async function quotePumpBuy({ target, buySol, buyerSecret, slippageBps = 500, jitoBundle = false, jitoTipSol = 0.005, priorityMicroLamports = 2_000_000 }) {
	const blockers = [];
	const cap = capBlocker(buySol, 'pump_buy');
	if (cap) blockers.push(cap);
	const buyer = signerAddress(buyerSecret, false);
	const lamports = Math.floor(Number(buySol) * LAMPORTS_PER_SOL);
	const quote = await fetchJupiterQuote({ outputMint: target, amount: lamports, slippageBps });
	const tip = jitoBundle ? clampJitoTipSol(jitoTipSol) : 0;
	const balance = await balanceLamports(buyer);
	const fee = BASE_FEE_LAMPORTS + priorityFeeLamports(priorityMicroLamports, 200_000);
	if (!jitoBundle && balance < lamports + fee) {
		blockers.push({
			code: 'insufficient_funds',
			message: `Buyer holds ${toSol(balance)} SOL; this buy needs ${toSol(lamports + fee)} SOL including fees.`,
		});
	}
	return {
		action: 'pump_buy',
		chain: 'solana-mainnet',
		venue: 'jupiter',
		buyer,
		target,
		spend_sol: Number(buySol),
		expected_out_atomics: quote.outAmount,
		min_out_atomics: quote.otherAmountThreshold,
		slippage_bps: Number(quote.slippageBps ?? slippageBps),
		price_impact_pct: Number(quote.priceImpactPct ?? 0) * 100,
		route: Array.isArray(quote.routePlan) ? quote.routePlan.map((r) => r.swapInfo?.label).filter(Boolean) : [],
		jito_tip_sol: tip,
		estimated_network_fee_sol: toSol(fee),
		buyer_balance_sol: toSol(balance),
		would_execute: blockers.length === 0,
		blockers,
	};
}

/** pump_launch: every SOL line the funder pays, checked against its balance. */
export async function previewPumpLaunch({ name, symbol, funderSecret, creatorSecret, rentSol = 0.035, devBuySol = 0, jitoTipSol = 0.005 }) {
	const blockers = [];
	if (!name) blockers.push({ code: 'invalid_input', message: 'name is required.' });
	if (!symbol) blockers.push({ code: 'invalid_input', message: 'symbol is required.' });
	const devBuy = Number(devBuySol) > 0 ? Number(devBuySol) : 0;
	const tip = clampJitoTipSol(jitoTipSol);
	const outlay = Number(rentSol) + devBuy + tip;
	for (const b of [
		capBlocker(rentSol, 'pump_launch creator rent'),
		devBuy ? capBlocker(devBuy, 'pump_launch dev buy') : null,
		capBlocker(outlay, 'pump_launch funder total outlay'),
	]) {
		if (b) blockers.push(b);
	}
	const funder = signerAddress(funderSecret, false);
	const creator = signerAddress(creatorSecret, false);
	const balance = await balanceLamports(funder);
	const needed = (Number(rentSol) + devBuy + tip + BUNDLE_FEE_HEADROOM_SOL) * LAMPORTS_PER_SOL;
	if (balance < needed) {
		blockers.push({
			code: 'insufficient_funds',
			message: `Funder needs at least ${toSol(needed)} SOL; holds ${toSol(balance)} SOL.`,
		});
	}
	return {
		action: 'pump_launch',
		chain: 'solana-mainnet',
		venue: 'pump.fun',
		name,
		symbol,
		funder,
		creator,
		creator_rent_sol: Number(rentSol),
		dev_buy_sol: devBuy,
		jito_tip_sol: tip,
		fee_headroom_sol: BUNDLE_FEE_HEADROOM_SOL,
		funder_total_outlay_sol: outlay + BUNDLE_FEE_HEADROOM_SOL,
		funder_balance_sol: toSol(balance),
		would_execute: blockers.length === 0,
		blockers,
	};
}

/** pump_collect_fees: the vault balance and exactly what lands at the destination. */
export async function previewPumpCollect({ funderSecret, creatorSecret, destination, jitoTipSol = 0.005, bufferLamports = RENT_EXEMPT_LAMPORTS, minVaultSol = 0.001 }) {
	const blockers = [];
	if (!isValidPubkey(destination)) {
		blockers.push({ code: 'invalid_destination', message: `Not a valid Solana pubkey: ${destination}` });
	} else {
		const allow = allowlistBlocker(destination, 'pump_collect_fees destination');
		if (allow) blockers.push(allow);
	}
	const funder = signerAddress(funderSecret, false);
	const creatorKp = keypairFromSecret(creatorSecret);
	const creator = creatorKp.publicKey.toBase58();
	const tip = clampJitoTipSol(jitoTipSol);
	const buffer = enforceMinBuffer(bufferLamports);

	const pumpSdkPkg = await import('@nirholas/pump-sdk');
	const OnlinePumpSdk = pumpSdkPkg.OnlinePumpSdk || pumpSdkPkg.default?.OnlinePumpSdk;
	if (!OnlinePumpSdk) throw Object.assign(new Error('@nirholas/pump-sdk: OnlinePumpSdk export missing'), { code: 'sdk_missing' });
	const conn = getConnection();
	const vaultLamports = Number(await new OnlinePumpSdk(conn).getCreatorVaultBalance(creatorKp.publicKey));
	const [creatorBal, funderBal] = await Promise.all([balanceLamports(creator), balanceLamports(funder)]);
	const drain = creatorBal + vaultLamports - buffer;

	if (vaultLamports < Math.floor(Number(minVaultSol) * LAMPORTS_PER_SOL)) {
		blockers.push({ code: 'vault_too_small', message: `Vault holds ${toSol(vaultLamports)} SOL, under the ${minVaultSol} SOL minimum.` });
	}
	if (drain <= 0) blockers.push({ code: 'nothing_to_drain', message: 'Nothing would be left to move after the rent buffer.' });
	if (drain > MAX_SOL_PER_TX * LAMPORTS_PER_SOL) {
		blockers.push({ code: 'over_spend_cap', message: `The drain of ${toSol(drain)} SOL exceeds the per-tx cap of ${MAX_SOL_PER_TX} SOL.` });
	}
	if (funderBal < (tip + BUNDLE_FEE_HEADROOM_SOL) * LAMPORTS_PER_SOL) {
		blockers.push({ code: 'insufficient_funds', message: `Funder needs ${tip + BUNDLE_FEE_HEADROOM_SOL} SOL for the tip and fees; holds ${toSol(funderBal)} SOL.` });
	}
	return {
		action: 'pump_collect_fees',
		chain: 'solana-mainnet',
		venue: 'pump.fun',
		creator,
		funder,
		destination,
		vault_sol: toSol(vaultLamports),
		creator_balance_sol: toSol(creatorBal),
		rent_buffer_sol: toSol(buffer),
		amount_to_destination_sol: toSol(Math.max(0, drain)),
		jito_tip_sol: tip,
		would_execute: blockers.length === 0,
		blockers,
	};
}
