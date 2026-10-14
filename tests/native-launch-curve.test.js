// The three.ws native launch lane: curve economics + the SDK-built config.
//
// These assertions are the guard rails on real money. The curve config is what
// decides how much of every trade reaches the coin's creator and the platform,
// where the coin graduates, and whether the graduated pool can be pulled — so a
// silent edit to config.js (or an SDK bump that reinterprets a field) has to
// fail here rather than on mainnet.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	buildCurveWithMarketCap,
	validateConfigParameters,
	getBaseFeeParams,
	getBaseFeeNumerator,
	feeNumeratorToBps,
	TokenType,
	TokenDecimal,
	TokenAuthorityOption,
	BaseFeeMode,
	CollectFeeMode,
	MigrationOption,
	MigrationFeeOption,
	ActivationType,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import { NATIVE_LANE, curveBuildParams, configKeyFor, laneInfo } from '../api/_lib/native-launch/config.js';

const params = () => curveBuildParams();

describe('native lane economics', () => {
	it('quotes in $THREE with a fixed 1B supply at 6 decimals', () => {
		expect(NATIVE_LANE.quote).toBe('$THREE');
		expect(NATIVE_LANE.quoteDecimals).toBe(6);
		expect(NATIVE_LANE.totalSupply).toBe(1_000_000_000);
		expect(NATIVE_LANE.decimals).toBe(6);
	});

	it('splits the trading fee evenly between creator and platform', () => {
		expect(NATIVE_LANE.tradeFeeBps).toBe(100); // 1%
		expect(NATIVE_LANE.creatorTradeFeePercent).toBe(50);
		const info = laneInfo('mainnet');
		expect(info.fee_split.creator_percent + info.fee_split.platform_percent).toBe(100);
	});

	it('locks 100% of graduated liquidity', () => {
		expect(NATIVE_LANE.lpLockedPercent).toBe(100);
		const { liquidityDistribution: d } = params();
		// Every LP share is permanently locked: nothing is withdrawable, which is
		// what makes a graduated native coin un-ruggable.
		expect(d.partnerLiquidityPercentage).toBe(0);
		expect(d.creatorLiquidityPercentage).toBe(0);
		expect(
			d.partnerPermanentLockedLiquidityPercentage + d.creatorPermanentLockedLiquidityPercentage,
		).toBe(100);
	});

	it('graduates above its starting market cap', () => {
		expect(NATIVE_LANE.migrationMarketCapThree).toBeGreaterThan(NATIVE_LANE.initialMarketCapThree);
	});
});

describe('curveBuildParams', () => {
	it('uses the SDK enum values the on-chain program expects', () => {
		const p = params();
		expect(p.token.tokenType).toBe(TokenType.SPLToken);
		expect(p.token.tokenBaseDecimal).toBe(TokenDecimal.SIX);
		expect(p.token.tokenQuoteDecimal).toBe(TokenDecimal.SIX);
		// Immutable metadata: no one, including us, can rewrite a launched coin.
		expect(p.token.tokenAuthorityOption).toBe(TokenAuthorityOption.Immutable);
		expect(p.fee.baseFeeParams.baseFeeMode).toBe(BaseFeeMode.FeeSchedulerExponential);
		// Fees accrue in the quote token so creators are paid in SOL, not in
		// their own (possibly worthless) coin.
		expect(p.fee.collectFeeMode).toBe(CollectFeeMode.QuoteToken);
		expect(p.migration.migrationOption).toBe(MigrationOption.MET_DAMM_V2);
		expect(p.migration.migrationFeeOption).toBe(MigrationFeeOption.FixedBps100);
		expect(p.activationType).toBe(ActivationType.Slot);
	});

	it('opens at a punitive anti-snipe fee that decays to the steady-state fee', () => {
		const { feeSchedulerParam: f } = params().fee.baseFeeParams;
		expect(f.startingFeeBps).toBe(NATIVE_LANE.antiSnipeStartFeeBps);
		expect(f.endingFeeBps).toBe(NATIVE_LANE.antiSnipeEndFeeBps);
		expect(f.endingFeeBps).toBe(NATIVE_LANE.tradeFeeBps);
		expect(f.startingFeeBps).toBeGreaterThan(f.endingFeeBps);
		expect(f.numberOfPeriod).toBe(NATIVE_LANE.antiSnipeDecayPeriods);
		expect(f.totalDuration).toBe(NATIVE_LANE.antiSnipeDecaySlots);
	});

	it('exempts only the creator-bundled first buy from the anti-snipe rate', () => {
		expect(params().fee.enableFirstSwapWithMinFee).toBe(true);
	});

	it('keeps a leftover dust unit so the program supply check passes', () => {
		// The DBC program requires curve + migration + leftover to reconcile
		// exactly against the fixed supply; leftover 0 is rejected on-chain with
		// InvalidTokenSupply. Verified against devnet before this was pinned.
		expect(params().token.leftover).toBeGreaterThan(0);
	});

	it('never vests or withholds supply from the curve', () => {
		const v = params().lockedVesting;
		expect(v.totalLockedVestingAmount).toBe(0);
		expect(v.cliffUnlockAmount).toBe(0);
	});
});

describe('anti-snipe fee schedule', () => {
	// feeAtSlot mirrors exactly what the DBC program does on-chain: resolve the
	// scheduler's cliff/reduction factors once (getBaseFeeParams), then evaluate
	// the fee at a given slot since pool activation (getBaseFeeNumerator). No
	// network call, no mocking of the curve math itself.
	const schedulerParams = () => getBaseFeeParams(params().fee.baseFeeParams);
	const activationPoint = new BN(0);
	function feeBpsAtSlot(slot) {
		const sp = schedulerParams();
		const numerator = getBaseFeeNumerator(
			sp.cliffFeeNumerator,
			sp.firstFactor,
			sp.secondFactor,
			sp.thirdFactor,
			sp.baseFeeMode,
			new BN(slot),
			activationPoint,
		);
		return feeNumeratorToBps(numerator);
	}

	it('starts at the configured anti-snipe fee in the pool\'s first slot', () => {
		expect(feeBpsAtSlot(0)).toBe(NATIVE_LANE.antiSnipeStartFeeBps);
	});

	it('decays monotonically slot by slot across the decay window', () => {
		let previous = feeBpsAtSlot(0);
		for (let slot = 1; slot <= NATIVE_LANE.antiSnipeDecaySlots; slot++) {
			const fee = feeBpsAtSlot(slot);
			expect(fee).toBeLessThanOrEqual(previous);
			previous = fee;
		}
	});

	it('reaches exactly the steady-state fee at the window\'s end, and stays there', () => {
		expect(feeBpsAtSlot(NATIVE_LANE.antiSnipeDecaySlots)).toBe(NATIVE_LANE.antiSnipeEndFeeBps);
		expect(feeBpsAtSlot(NATIVE_LANE.antiSnipeDecaySlots + 1000)).toBe(NATIVE_LANE.antiSnipeEndFeeBps);
	});

	it('taxes a snipe in the first few slots well above the steady-state fee', () => {
		// A bot landing in slot 1-3 (one to a couple of blocks after activation)
		// should still pay a meaningfully punitive fee, not something close to normal.
		expect(feeBpsAtSlot(2)).toBeGreaterThan(NATIVE_LANE.antiSnipeEndFeeBps * 10);
	});
});

describe('curve built through the SDK', () => {
	const built = () => buildCurveWithMarketCap(params());

	it('passes the SDK config validator', () => {
		expect(() =>
			validateConfigParameters({
				...built(),
				leftoverReceiver: Keypair.generate().publicKey,
			}),
		).not.toThrow();
	});

	it('graduates near the advertised $THREE raise', () => {
		const three = Number(built().migrationQuoteThreshold.toString()) / 10 ** NATIVE_LANE.quoteDecimals;
		// laneInfo advertises graduation_three_approx to users; it must stay within
		// 0.1% of what the curve actually enforces or the UI is lying.
		expect(Math.abs(three - NATIVE_LANE.graduationThreeApprox) / three).toBeLessThan(0.001);
	});

	it('carries the creator fee share and migration fee onto the config', () => {
		const cfg = built();
		expect(cfg.creatorTradingFeePercentage).toBe(NATIVE_LANE.creatorTradeFeePercent);
		expect(cfg.migrationFee.feePercentage).toBe(NATIVE_LANE.migrationFeePercent);
		expect(cfg.migrationFee.creatorFeePercentage).toBe(NATIVE_LANE.creatorMigrationFeePercent);
	});

	it('produces a rising multi-point curve', () => {
		const curve = built().curve;
		expect(curve.length).toBeGreaterThan(1);
		for (let i = 1; i < curve.length; i++) {
			expect(curve[i].sqrtPrice.gt(curve[i - 1].sqrtPrice)).toBe(true);
		}
	});

	it('starts strictly below the graduation price', () => {
		const cfg = built();
		expect(cfg.sqrtStartPrice.lt(cfg.curve[cfg.curve.length - 1].sqrtPrice)).toBe(true);
	});
});

describe('config key resolution', () => {
	const saved = {};
	beforeEach(() => {
		saved.main = process.env.NATIVE_LAUNCH_CONFIG_KEY;
		saved.dev = process.env.NATIVE_LAUNCH_CONFIG_KEY_DEVNET;
	});
	afterEach(() => {
		if (saved.main === undefined) delete process.env.NATIVE_LAUNCH_CONFIG_KEY;
		else process.env.NATIVE_LAUNCH_CONFIG_KEY = saved.main;
		if (saved.dev === undefined) delete process.env.NATIVE_LAUNCH_CONFIG_KEY_DEVNET;
		else process.env.NATIVE_LAUNCH_CONFIG_KEY_DEVNET = saved.dev;
	});

	it('reads the network-matched env var', () => {
		process.env.NATIVE_LAUNCH_CONFIG_KEY = 'MainnetConfigKey1111111111111111111111111111';
		process.env.NATIVE_LAUNCH_CONFIG_KEY_DEVNET = 'DevnetConfigKey11111111111111111111111111111';
		expect(configKeyFor('mainnet')).toBe('MainnetConfigKey1111111111111111111111111111');
		expect(configKeyFor('devnet')).toBe('DevnetConfigKey11111111111111111111111111111');
	});

	it('reports the lane unavailable when its network has no config', () => {
		delete process.env.NATIVE_LAUNCH_CONFIG_KEY;
		expect(configKeyFor('mainnet')).toBeNull();
		expect(laneInfo('mainnet').config_key).toBeNull();
	});
});
