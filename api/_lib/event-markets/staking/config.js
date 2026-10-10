// Policy for staked Event Markets: which tokens, how much, what the house keeps,
// and who may stake. Every number here is a RECOMMENDATION pending the owner's
// decision (docs/event-markets-staking.md, "Owner decisions"). Defaults err on
// the side of small stakes and a closed door: staking is off until
// EVENT_MARKETS_STAKING_ENABLED=1.

import { env } from '../../env.js';

export const CLUSTERS = {
	localnet: { rpc: 'http://127.0.0.1:8899' },
	devnet: { rpc: null },
	mainnet: { rpc: null },
};

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** Base-unit limits per token. USDC has 6 decimals; so does the platform coin. */
export const TOKENS = {
	usdc: {
		symbol: 'USDC', decimals: 6,
		min: 1_000_000n, //           1 USDC
		maxStake: 100_000_000n, //    100 USDC per account per market
		maxPool: 5_000_000_000n, //   5,000 USDC per market
		dailyCap: 250_000_000n, //    250 USDC staked per account per rolling 24h
	},
	three: {
		symbol: '$THREE', decimals: 6,
		min: 1_000_000_000n, //             1,000 $THREE
		maxStake: 1_000_000_000_000n, //    1,000,000 $THREE
		maxPool: 50_000_000_000_000n, //    50,000,000 $THREE
		dailyCap: 2_500_000_000_000n, //    2,500,000 $THREE
	},
};

/** House fee: 3% of the pool, half of it routed to the $THREE buyback. */
export const FEE = { feeBps: 300, buybackShareBps: 5000 };
/** Pools void themselves (everyone refunded) this long after the lock if unresolved. */
export const VOID_AFTER_LOCK_SECONDS = 7 * 24 * 3600;

export const TERMS_VERSION = '2026-10-13';

export function stakingConfig() {
	const cluster = process.env.EVENT_MARKETS_STAKE_CLUSTER || 'devnet';
	if (!CLUSTERS[cluster]) throw new Error(`EVENT_MARKETS_STAKE_CLUSTER must be one of ${Object.keys(CLUSTERS).join(', ')}`);
	return {
		enabled: process.env.EVENT_MARKETS_STAKING_ENABLED === '1',
		cluster,
		rpcUrl: process.env.EVENT_MARKETS_STAKE_RPC_URL
			|| (cluster === 'mainnet' ? env.SOLANA_RPC_URL : cluster === 'devnet' ? env.SOLANA_RPC_URL_DEVNET : CLUSTERS.localnet.rpc),
		minAge: Number(process.env.EVENT_MARKETS_STAKING_MIN_AGE || 21),
		blockedCountries: new Set((process.env.EVENT_MARKETS_STAKING_BLOCKED_COUNTRIES || 'US,GB,FR,AU,SG,CN,KP,IR,CU,SY,RU,BY,MM,SD,SS')
			.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)),
	};
}

export function mintFor(tokenKey, cluster) {
	if (tokenKey === 'usdc') return cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET;
	if (tokenKey === 'three') return env.THREE_TOKEN_MINT || 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
	throw new Error(`unknown stake token ${tokenKey}`);
}
