// Shared payment configuration.
// All prices are in USDC (6 decimals on EVM, 6 decimals on Solana SPL).

export const PLANS = {
	pro:        { label: 'Pro',        price_usd: 19,  duration_days: 30 },
	team:       { label: 'Team',       price_usd: 79,  duration_days: 30 },
	enterprise: { label: 'Enterprise', price_usd: 299, duration_days: 30 },
};

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

// USDC has 6 decimals on both EVM and Solana.
export function toUsdcAtomics(usd) {
	return BigInt(Math.round(usd * 1_000_000));
}
