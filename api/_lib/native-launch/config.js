// three.ws native launchpad — curve economics, in one place.
//
// The native lane runs on Meteora's Dynamic Bonding Curve (DBC) program with
// three.ws as the on-chain "partner": we define the curve config, collect the
// platform's share of trading fees, and every pool created under our config
// key belongs to the three.ws launchpad.
//
// Curve design (v2, $THREE-quoted):
//   - every coin is priced in, bought with, and graduates into a pool against
//     $THREE. Buying any coin on this lane means buying $THREE first, the fees
//     creators earn are paid in $THREE, and each graduation locks the $THREE it
//     raised in a pool nobody can withdraw. SOL-quoted launches are what the
//     pump.fun lane is for; this lane exists to put $THREE at the centre.
//   - 1B supply, 6 decimals, immutable metadata authority (no rug lever)
//   - starts at a 4M $THREE market cap, graduates at 60M $THREE
//     (about 12.3M $THREE raised on the curve, roughly 1.2% of $THREE's supply
//     per graduated coin). Sized to match pump.fun's 28 -> 410 SOL shape at the
//     $THREE price on 2026-09-20. The thresholds are fixed in the on-chain
//     config, so re-sizing them later means creating a new config and
//     re-pinning the env key; coins already launched keep the curve they had.
//   - 1% trading fee in $THREE, split 50/50 creator / three.ws, plus Meteora's
//     volatility-scaled dynamic fee on top during spikes
//   - graduates to DAMM v2 with 100% of LP permanently locked (50 creator /
//     50 platform): the pool can never be pulled, both sides earn LP fees
//     forever
//   - 1% migration fee on the raised $THREE, split 50/50 creator / three.ws
//
// The quote mint is verified acceptable to the DBC program: $THREE is a Token-2022
// mint carrying only the metadata-pointer and token-metadata extensions, with no
// mint or freeze authority, and a mainnet simulation of createConfig against it
// succeeds (scripts/native-launchpad-create-config.mjs --simulate).
//
// The partner config account is created once per network by
// scripts/native-launchpad-create-config.mjs and pinned via env:
//   NATIVE_LAUNCH_CONFIG_KEY          (mainnet config pubkey)
//   NATIVE_LAUNCH_CONFIG_KEY_DEVNET   (devnet config pubkey)
//   NATIVE_LAUNCH_QUOTE_MINT_DEVNET   (devnet stand-in for $THREE, which only
//                                      exists on mainnet)
//   NATIVE_LAUNCH_FEE_WALLET          (platform fee claimer + leftover receiver)

import { env } from '../env.js';

export const NATIVE_LANE = {
	id: 'native',
	label: 'three.ws launchpad',
	quote: '$THREE',
	quoteDecimals: 6,
	totalSupply: 1_000_000_000,
	decimals: 6,
	initialMarketCapThree: 4_000_000,
	migrationMarketCapThree: 60_000_000,
	// buildCurveWithMarketCap resolves this to 12,338,105 $THREE for the params
	// above; kept here as display metadata only. The on-chain config is authoritative.
	graduationThreeApprox: 12_340_000,
	tradeFeeBps: 100,
	creatorTradeFeePercent: 50, // % of the trade fee that goes to the coin creator
	migrationFeePercent: 1,
	creatorMigrationFeePercent: 50,
	lpLockedPercent: 100,
};

// Params for buildCurveWithMarketCap(). Enum values are inlined as numbers so
// this module stays importable without pulling the SDK (the SDK is only
// loaded lazily by dbc.js); dbc.js asserts them against the real enums.
export function curveBuildParams() {
	return {
		token: {
			tokenType: 0, // TokenType.SPLToken
			tokenBaseDecimal: NATIVE_LANE.decimals, // TokenDecimal.SIX
			tokenQuoteDecimal: NATIVE_LANE.quoteDecimals, // TokenDecimal.SIX ($THREE)
			tokenAuthorityOption: 1, // TokenAuthorityOption.Immutable
			totalTokenSupply: NATIVE_LANE.totalSupply,
			// The DBC program requires curve + migration + leftover to sum exactly
			// to the fixed supply; leftover 0 fails its rounding check on-chain
			// (InvalidTokenSupply). One base unit of dust satisfies it.
			leftover: 1,
		},
		fee: {
			baseFeeParams: {
				baseFeeMode: 0, // BaseFeeMode.FeeSchedulerLinear (flat: start == end)
				feeSchedulerParam: {
					startingFeeBps: NATIVE_LANE.tradeFeeBps,
					endingFeeBps: NATIVE_LANE.tradeFeeBps,
					numberOfPeriod: 0,
					totalDuration: 0,
				},
			},
			dynamicFeeEnabled: true,
			collectFeeMode: 0, // CollectFeeMode.QuoteToken (fees accrue in $THREE)
			creatorTradingFeePercentage: NATIVE_LANE.creatorTradeFeePercent,
			poolCreationFee: 0,
			enableFirstSwapWithMinFee: true, // creator's own first buy pays the minimum fee
		},
		migration: {
			migrationOption: 1, // MigrationOption.MET_DAMM_V2
			migrationFeeOption: 2, // MigrationFeeOption.FixedBps100 (1% fee on the graduated pool)
			migrationFee: {
				feePercentage: NATIVE_LANE.migrationFeePercent,
				creatorFeePercentage: NATIVE_LANE.creatorMigrationFeePercent,
			},
		},
		liquidityDistribution: {
			partnerPermanentLockedLiquidityPercentage: 50,
			partnerLiquidityPercentage: 0,
			creatorPermanentLockedLiquidityPercentage: 50,
			creatorLiquidityPercentage: 0,
		},
		lockedVesting: {
			totalLockedVestingAmount: 0,
			numberOfVestingPeriod: 0,
			cliffUnlockAmount: 0,
			totalVestingDuration: 0,
			cliffDurationFromMigrationTime: 0,
		},
		activationType: 0, // ActivationType.Slot
		initialMarketCap: NATIVE_LANE.initialMarketCapThree,
		migrationMarketCap: NATIVE_LANE.migrationMarketCapThree,
	};
}

export function configKeyFor(network) {
	return network === 'devnet'
		? env.NATIVE_LAUNCH_CONFIG_KEY_DEVNET || null
		: env.NATIVE_LAUNCH_CONFIG_KEY || null;
}

// The mint every coin on this lane is quoted in: $THREE on mainnet. $THREE does not
// exist on devnet, so devnet runs against a stand-in mint with the same token
// program, decimals and extensions (scripts/native-launchpad-create-config.mjs
// --network devnet creates one and prints the env line).
export function quoteMintFor(network) {
	return network === 'devnet' ? env.NATIVE_LAUNCH_QUOTE_MINT_DEVNET || null : env.THREE_TOKEN_MINT;
}

export function feeWallet() {
	return env.NATIVE_LAUNCH_FEE_WALLET || null;
}

// Public, cacheable description of the lane — served by /api/native-launch/config
// and rendered by the launch UI so the fee story on the page can never drift
// from the config that actually launched the coin.
export function laneInfo(network = 'mainnet') {
	return {
		lane: NATIVE_LANE.id,
		label: NATIVE_LANE.label,
		network,
		config_key: configKeyFor(network),
		quote: NATIVE_LANE.quote,
		quote_mint: quoteMintFor(network),
		quote_decimals: NATIVE_LANE.quoteDecimals,
		total_supply: NATIVE_LANE.totalSupply,
		decimals: NATIVE_LANE.decimals,
		initial_market_cap_three: NATIVE_LANE.initialMarketCapThree,
		migration_market_cap_three: NATIVE_LANE.migrationMarketCapThree,
		graduation_three_approx: NATIVE_LANE.graduationThreeApprox,
		trade_fee_bps: NATIVE_LANE.tradeFeeBps,
		fee_split: {
			creator_percent: NATIVE_LANE.creatorTradeFeePercent,
			platform_percent: 100 - NATIVE_LANE.creatorTradeFeePercent,
		},
		migration_fee_percent: NATIVE_LANE.migrationFeePercent,
		lp_locked_percent: NATIVE_LANE.lpLockedPercent,
		graduates_to: 'Meteora DAMM v2 against $THREE (LP permanently locked, creator keeps earning LP fees)',
	};
}
