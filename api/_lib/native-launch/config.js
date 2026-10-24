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
//   - 1% steady-state trading fee in $THREE, split 50/50 creator / three.ws, plus
//     Meteora's volatility-scaled dynamic fee on top during spikes. A new pool opens
//     at a 50% anti-snipe fee that decays to that 1% over the first 100 slots
//     (~40s), so a bot buying in the pool's first blocks pays far more than someone
//     buying a minute later; the creator's own first buy is exempt.
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
import {
	FEE_SCHEDULE_MODES,
	MIN_FEE_BPS,
	MAX_FEE_BPS,
	describeFeeSchedule,
	describeReferral,
	referralShareOfTradingFeePercent,
} from '../../../src/shared/launch-fees.js';

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
	// Anti-snipe decaying fee: the owner's EVM `anti-snipe-ramp` hook opens a pool at a
	// punitive fee that decays to normal so bots sniping the first blocks pay for it.
	// This is that mechanism on Solana, built on the DBC program's own fee scheduler
	// instead of a new contract. activationType is Slot (below), so the window below
	// is measured in slots, not seconds.
	antiSnipeStartFeeBps: 5_000, // 50% for a buy landing in the pool's first slot
	antiSnipeEndFeeBps: 100, // decays down to the steady-state 1% trade fee (tradeFeeBps)
	antiSnipeDecayPeriods: 25, // discrete steps the fee drops through on its way down
	// 100 slots at Solana's ~400ms/slot is about 40 seconds: long enough to tax a sniper
	// bot's first few blocks hard, short enough that an organic buyer a block or two
	// later already sees most of the fee gone (exponential decay front-loads the drop).
	antiSnipeDecaySlots: 100,
};

// The lane's own decaying-fee schedule in the shape src/shared/launch-fees.js
// validates, so the page, the preview endpoint and the on-chain config all read
// the same numbers.
export function defaultFeeSchedule() {
	return {
		mode: 'exponential',
		start_fee_bps: NATIVE_LANE.antiSnipeStartFeeBps,
		end_fee_bps: NATIVE_LANE.antiSnipeEndFeeBps,
		periods: NATIVE_LANE.antiSnipeDecayPeriods,
		duration_slots: NATIVE_LANE.antiSnipeDecaySlots,
	};
}

// Params for buildCurveWithMarketCap(). Enum values are inlined as numbers so
// this module stays importable without pulling the SDK (the SDK is only
// loaded lazily by dbc.js); dbc.js asserts them against the real enums.
//
// `feeSchedule` (already run through validateFeeSchedule) swaps in a different
// decaying-fee schedule for a candidate config; omitted, it builds the live lane.
export function curveBuildParams({ feeSchedule = defaultFeeSchedule() } = {}) {
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
				// FeeSchedulerExponential, not RateLimiter: this SDK's own
				// getBaseFeeParams() throws "BaseFeeMode.RateLimiter is deprecated.
				// New configs must use FeeSchedulerLinear or FeeSchedulerExponential"
				// for any new config, which settles the choice the task asked to
				// measure on devnet before it gets there. Exponential over linear
				// because it front-loads the decay (steepest drop right after
				// activation, where the snipers are, instead of a constant slope).
				baseFeeMode: FEE_SCHEDULE_MODES[feeSchedule.mode], // 0 Linear, 1 Exponential
				feeSchedulerParam: {
					startingFeeBps: feeSchedule.start_fee_bps,
					endingFeeBps: feeSchedule.end_fee_bps,
					numberOfPeriod: feeSchedule.periods,
					totalDuration: feeSchedule.duration_slots,
				},
			},
			dynamicFeeEnabled: true,
			collectFeeMode: 0, // CollectFeeMode.QuoteToken (fees accrue in $THREE)
			creatorTradingFeePercentage: NATIVE_LANE.creatorTradeFeePercent,
			poolCreationFee: 0,
			// The creator's own buy is bundled into the same transaction as pool
			// creation (buildCreatePoolTx's firstBuyParam), so it is the only
			// "snipe-shaped" buy that is actually the creator funding their own
			// launch. This keeps it exempt from the anti-snipe rate: it always
			// pays the lane's minimum fee, never the decaying start fee.
			enableFirstSwapWithMinFee: true,
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
		anti_snipe: {
			start_fee_bps: NATIVE_LANE.antiSnipeStartFeeBps,
			end_fee_bps: NATIVE_LANE.antiSnipeEndFeeBps,
			decay_periods: NATIVE_LANE.antiSnipeDecayPeriods,
			decay_slots: NATIVE_LANE.antiSnipeDecaySlots,
			creator_first_buy_exempt: true,
		},
		fee_schedule: defaultFeeSchedule(),
		fee_schedule_preview: describeFeeSchedule(defaultFeeSchedule()),
		fee_limits: { min_fee_bps: MIN_FEE_BPS, max_fee_bps: MAX_FEE_BPS, slot_seconds: 0.4 },
		referral: {
			share_of_trading_fee_percent: referralShareOfTradingFeePercent(),
			preview: describeReferral(),
		},
		migration_fee_percent: NATIVE_LANE.migrationFeePercent,
		lp_locked_percent: NATIVE_LANE.lpLockedPercent,
		graduates_to: 'Meteora DAMM v2 against $THREE (LP permanently locked, creator keeps earning LP fees)',
	};
}
