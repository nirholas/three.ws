// Shared payment configuration.
// Prices are set in USD. On-chain settlement is USDC (6 decimals on EVM and
// Solana), native SOL, or $THREE (Solana-only; see PLAN_ASSETS below).

import { PLANS as PLAN_ROWS, BILLING_PERIOD_DAYS } from '../_lib/plans.js';

// Purchasable plans, priced from data/plans.json (the single source the
// /pricing page, the docs and the quota checks also read), so checkout always
// quotes the number the pricing page shows.
export const PLANS = Object.freeze(
	Object.fromEntries(
		PLAN_ROWS.filter((p) => p.purchasable).map((p) => [
			p.id,
			Object.freeze({ label: p.name, price_usd: p.price_usd, duration_days: BILLING_PERIOD_DAYS }),
		]),
	),
);

// Assets accepted for plan checkout on Solana. USDC settles 1:1 with the USD
// price; SOL and $THREE are quoted at the live price when the checkout session
// is created and the exact on-chain amount is pinned on the intent.
export const PLAN_ASSETS = ['USDC', 'SOL', 'THREE'];

// Paying in $THREE takes a discount off the USD price — $THREE is the
// platform's coin and plan revenue in it feeds the treasury loop directly.
// Basis points; 2000 = 20% off. Override with THREE_PLAN_DISCOUNT_BPS.
export function threePlanDiscountBps() {
	const raw = (process.env.THREE_PLAN_DISCOUNT_BPS ?? '').trim();
	if (raw !== '') {
		const n = Number(raw);
		if (Number.isFinite(n) && n >= 0 && n <= 5000) return Math.floor(n);
	}
	return 2000;
}

/** USD value charged for a plan when paying in `asset` ($THREE discount applied). */
export function planPriceUsd(plan, asset = 'USDC') {
	const base = PLANS[plan].price_usd;
	if (asset !== 'THREE') return base;
	const usd = (base * (10_000 - threePlanDiscountBps())) / 10_000;
	return Math.round(usd * 100) / 100;
}

// USDC contract addresses by EVM chain ID.
export const EVM_USDC = {
	1:       '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum
	8453:    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
	10:      '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // Optimism
	42161:   '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One
	137:     '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon
	11155111:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia (test)
	84532:   '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia (test)
};

// Solana USDC mint.
export const SOLANA_USDC_MINT = process.env.SOLANA_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // mainnet
export const SOLANA_USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Recipient addresses — set these in env to your treasury wallets.
export function getEvmRecipient(chainId) {
	return process.env[`PAYMENT_RECIPIENT_EVM_${chainId}`] || process.env.PAYMENT_RECIPIENT_EVM || null;
}
export function getSolanaRecipient() {
	return process.env.PAYMENT_RECIPIENT_SOLANA || null;
}

// How long a checkout session stays valid.
export const INTENT_TTL_MINUTES = 30;

// Price-quoted assets (SOL, $THREE) pin the on-chain amount at checkout, so
// their sessions are shorter — a 30-minute-old quote on a moving market would
// over- or under-charge. The client just re-creates the checkout on expiry.
export const QUOTED_INTENT_TTL_MINUTES = 10;

// USDC has 6 decimals on both EVM and Solana.
export function toUsdcAtomics(usd) {
	return BigInt(Math.round(usd * 1_000_000));
}
