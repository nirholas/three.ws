// api/_lib/x402/prepaid-constants.js
//
// Network and asset the prepaid rail runs on. Kept free of chain imports so the
// ledger, the route hook and the tests can read them without loading the
// transaction stack. Solana only; USDC only.

import { NETWORK_SOLANA_MAINNET } from './solana-networks.js';

export const PREPAID_NETWORK = NETWORK_SOLANA_MAINNET;
export const USDC_MINT_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DECIMALS = 6;
export const PREPAID_ASSET = USDC_MINT_SOLANA;
