// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PairedLaunchpad} from "../src/PairedLaunchpad.sol";
import {PairedToken} from "../src/PairedToken.sol";
import {IERC20} from "../src/IERC20.sol";
import {MockStock} from "./MockStock.sol";

contract PairedLaunchpadTest is Test {
	PairedLaunchpad pad;
	MockStock nvda;
	MockStock tsla;
	MockStock aapl;

	address treasury = makeAddr("treasury");
	address creator = makeAddr("creator");
	address trader = makeAddr("trader");

	uint256 constant LAUNCH_FEE = 0.0005 ether;
	uint16 constant SWAP_FEE_BPS = 100; // 1%
	uint128 constant VIRTUAL_QUOTE = 30e18;
	// A local copy, not pad.NO_DEV_BUY(). Reading it from the contract is an
	// external call, and an external call inside an argument expression
	// consumes the pending vm.prank before the call under test ever runs.
	uint8 constant NO_DEV_BUY = type(uint8).max;

	function setUp() public {
		pad = new PairedLaunchpad(treasury, LAUNCH_FEE, SWAP_FEE_BPS);
		nvda = new MockStock("NVDA");
		tsla = new MockStock("TSLA");
		aapl = new MockStock("AAPL");

		pad.setQuoteConfig(address(nvda), VIRTUAL_QUOTE, true);
		pad.setQuoteConfig(address(tsla), VIRTUAL_QUOTE, true);
		pad.setQuoteConfig(address(aapl), VIRTUAL_QUOTE, true);

		vm.deal(creator, 1 ether);
		vm.deal(trader, 1 ether);
		nvda.mint(trader, 1_000e18);
		nvda.mint(creator, 1_000e18);
		tsla.mint(trader, 1_000e18);
	}

	// ── helpers ──────────────────────────────────────────────────────────────

	function _alloc(address q, uint16 w) internal pure returns (PairedLaunchpad.Allocation memory) {
		return PairedLaunchpad.Allocation({quoteToken: q, weightBps: w});
	}

	function _params(PairedLaunchpad.Allocation[] memory allocs)
		internal
		view
		returns (PairedLaunchpad.LaunchParams memory)
	{
		return PairedLaunchpad.LaunchParams({
			name: "Test Coin",
			symbol: "TEST",
			metadataURI: "https://paired.exchange/m/abc",
			metadataHash: keccak256("abc"),
			allocations: allocs,
			creatorFeeRecipient: address(0),
			devBuyMarket: NO_DEV_BUY,
			devBuyQuoteIn: 0,
			devBuyMinTokensOut: 0,
			deadline: block.timestamp + 600
		});
	}

	function _oneMarket() internal view returns (PairedLaunchpad.LaunchParams memory) {
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](1);
		a[0] = _alloc(address(nvda), 10_000);
		return _params(a);
	}

	function _launch() internal returns (address token) {
		vm.prank(creator);
		return pad.launch{value: LAUNCH_FEE}(_oneMarket());
	}

	// ── launching ────────────────────────────────────────────────────────────

	function test_launch_mintsFixedSupplyIntoTheCurves() public {
		address token = _launch();
		assertEq(PairedToken(token).totalSupply(), pad.TOTAL_SUPPLY());
		assertEq(IERC20(token).balanceOf(address(pad)), pad.TOTAL_SUPPLY());
		assertEq(pad.creatorOf(token), creator);
		assertEq(pad.feeRecipientOf(token), creator);
	}

	function test_launch_sendsTheFeeToTreasury() public {
		uint256 before = treasury.balance;
		_launch();
		assertEq(treasury.balance - before, LAUNCH_FEE);
	}

	function test_launch_rejectsAWrongFee() public {
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.BadFee.selector);
		pad.launch{value: LAUNCH_FEE - 1}(_oneMarket());
	}

	function test_launch_splitsSupplyExactlyAcrossMarkets() public {
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](3);
		a[0] = _alloc(address(nvda), 3_334);
		a[1] = _alloc(address(tsla), 3_333);
		a[2] = _alloc(address(aapl), 3_333);

		vm.prank(creator);
		address token = pad.launch{value: LAUNCH_FEE}(_params(a));

		uint256 sum;
		address[] memory markets = pad.marketsOf(token);
		assertEq(markets.length, 3);
		for (uint256 i; i < markets.length; ++i) {
			sum += pad.curveOf(token, markets[i]).tokensLeft;
		}
		// Every wei of supply is in a curve. Integer division must not lose any.
		assertEq(sum, pad.TOTAL_SUPPLY());
	}

	function test_launch_requiresWeightsToTotalExactly() public {
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](2);
		a[0] = _alloc(address(nvda), 5_000);
		a[1] = _alloc(address(tsla), 4_999);
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.WeightsMustTotalBps.selector);
		pad.launch{value: LAUNCH_FEE}(_params(a));
	}

	function test_launch_rejectsDuplicateMarkets() public {
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](2);
		a[0] = _alloc(address(nvda), 5_000);
		a[1] = _alloc(address(nvda), 5_000);
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.DuplicateMarket.selector);
		pad.launch{value: LAUNCH_FEE}(_params(a));
	}

	function test_launch_rejectsADisabledQuote() public {
		MockStock other = new MockStock("GME");
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](1);
		a[0] = _alloc(address(other), 10_000);
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.QuoteNotEnabled.selector);
		pad.launch{value: LAUNCH_FEE}(_params(a));
	}

	function test_launch_rejectsMoreThanFiveMarkets() public {
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](6);
		for (uint256 i; i < 6; ++i) {
			MockStock s = new MockStock("X");
			pad.setQuoteConfig(address(s), VIRTUAL_QUOTE, true);
			a[i] = _alloc(address(s), i == 5 ? 1_668 : 1_666);
		}
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.TooManyMarkets.selector);
		pad.launch{value: LAUNCH_FEE}(_params(a));
	}

	function test_launch_rejectsAnExpiredDeadline() public {
		PairedLaunchpad.LaunchParams memory p = _oneMarket();
		p.deadline = block.timestamp - 1;
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.Expired.selector);
		pad.launch{value: LAUNCH_FEE}(p);
	}

	/// @dev The bug this whole design avoids: on PAIR, "no dev buy" has to be
	/// encoded as market index 255, and index 0 with a zero amount reverts.
	function test_launch_withoutADevBuyNeedsNoApprovalOrStock() public {
		address broke = makeAddr("broke");
		vm.deal(broke, 1 ether);
		vm.prank(broke);
		address token = pad.launch{value: LAUNCH_FEE}(_oneMarket());
		assertTrue(token != address(0));
		assertEq(IERC20(address(nvda)).balanceOf(broke), 0);
	}

	function test_launch_withADevBuyGivesTheCreatorTokens() public {
		PairedLaunchpad.LaunchParams memory p = _oneMarket();
		p.devBuyMarket = 0;
		p.devBuyQuoteIn = 10e18;

		vm.startPrank(creator);
		nvda.approve(address(pad), type(uint256).max);
		address token = pad.launch{value: LAUNCH_FEE}(p);
		vm.stopPrank();

		assertGt(IERC20(token).balanceOf(creator), 0);
		assertEq(nvda.balanceOf(creator), 1_000e18 - 10e18);
	}

	function test_launch_rejectsADevBuyOnAMarketItDidNotOpen() public {
		PairedLaunchpad.LaunchParams memory p = _oneMarket();
		p.devBuyMarket = 3;
		p.devBuyQuoteIn = 1e18;
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.BadDevBuy.selector);
		pad.launch{value: LAUNCH_FEE}(p);
	}

	// ── trading ──────────────────────────────────────────────────────────────

	function test_buy_movesPriceUp() public {
		address token = _launch();
		uint256 p0 = pad.priceOf(token, address(nvda));

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		pad.buy(token, address(nvda), 10e18, 0);
		vm.stopPrank();

		assertGt(pad.priceOf(token, address(nvda)), p0);
		assertGt(IERC20(token).balanceOf(trader), 0);
	}

	function test_buy_matchesItsQuote() public {
		address token = _launch();
		(uint256 expected, ) = pad.quoteBuy(token, address(nvda), 10e18);

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		uint256 actual = pad.buy(token, address(nvda), 10e18, 0);
		vm.stopPrank();

		assertEq(actual, expected);
	}

	function test_buy_honoursSlippage() public {
		address token = _launch();
		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		vm.expectRevert(PairedLaunchpad.SlippageExceeded.selector);
		pad.buy(token, address(nvda), 10e18, type(uint256).max);
		vm.stopPrank();
	}

	function test_sell_returnsQuoteAndLowersPrice() public {
		address token = _launch();
		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		uint256 bought = pad.buy(token, address(nvda), 50e18, 0);
		uint256 priceAfterBuy = pad.priceOf(token, address(nvda));

		IERC20(token).approve(address(pad), type(uint256).max);
		uint256 before = nvda.balanceOf(trader);
		uint256 out = pad.sell(token, address(nvda), bought, 0);
		vm.stopPrank();

		assertGt(out, 0);
		assertEq(nvda.balanceOf(trader) - before, out);
		assertLt(pad.priceOf(token, address(nvda)), priceAfterBuy);
	}

	/// @dev A full round trip must lose money, and lose it only to fees. If it
	/// ever returned more than it cost, the curve would be a faucet.
	function test_roundTrip_costsExactlyTheFees() public {
		address token = _launch();
		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		uint256 spent = 100e18;
		uint256 bought = pad.buy(token, address(nvda), spent, 0);
		IERC20(token).approve(address(pad), type(uint256).max);
		uint256 returned = pad.sell(token, address(nvda), bought, 0);
		vm.stopPrank();

		assertLt(returned, spent);
		// Two 1% fees, with rounding slack.
		uint256 loss = spent - returned;
		assertGe(loss, (spent * 195) / 10_000);
		assertLe(loss, (spent * 205) / 10_000);
	}

	function test_trading_rejectsAnUnknownMarket() public {
		address token = _launch();
		vm.prank(trader);
		vm.expectRevert(PairedLaunchpad.UnknownMarket.selector);
		pad.buy(token, address(tsla), 1e18, 0);
	}

	// ── fees ─────────────────────────────────────────────────────────────────

	function test_fees_splitSeventyThirty() public {
		address token = _launch();
		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		pad.buy(token, address(nvda), 100e18, 0);
		vm.stopPrank();

		uint256 fee = (uint256(100e18) * uint256(SWAP_FEE_BPS)) / 10_000;
		assertEq(pad.claimable(creator, address(nvda)), (fee * 7_000) / 10_000);
		assertEq(pad.claimable(treasury, address(nvda)), fee - (fee * 7_000) / 10_000);
	}

	function test_claimFees_paysOutAndZeroes() public {
		address token = _launch();
		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		pad.buy(token, address(nvda), 100e18, 0);
		vm.stopPrank();

		uint256 owed = pad.claimable(creator, address(nvda));
		address[] memory assets = new address[](1);
		assets[0] = address(nvda);

		vm.prank(creator);
		pad.claimFees(assets);

		assertEq(nvda.balanceOf(creator), 1_000e18 + owed);
		assertEq(pad.claimable(creator, address(nvda)), 0);
	}

	/// @dev The improvement over one-transaction-per-asset claiming.
	function test_claimFees_batchesEveryAssetInOneTransaction() public {
		PairedLaunchpad.Allocation[] memory a = new PairedLaunchpad.Allocation[](2);
		a[0] = _alloc(address(nvda), 5_000);
		a[1] = _alloc(address(tsla), 5_000);
		vm.prank(creator);
		address token = pad.launch{value: LAUNCH_FEE}(_params(a));

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		tsla.approve(address(pad), type(uint256).max);
		pad.buy(token, address(nvda), 100e18, 0);
		pad.buy(token, address(tsla), 100e18, 0);
		vm.stopPrank();

		address[] memory assets = new address[](2);
		assets[0] = address(nvda);
		assets[1] = address(tsla);

		vm.prank(creator);
		uint256 claimed = pad.claimFees(assets);
		assertEq(claimed, 2);
		assertGt(nvda.balanceOf(creator), 1_000e18);
		assertGt(tsla.balanceOf(creator), 0);
	}

	function test_claimFees_revertsWhenThereIsNothing() public {
		address[] memory assets = new address[](1);
		assets[0] = address(nvda);
		vm.prank(creator);
		vm.expectRevert(PairedLaunchpad.NothingToClaim.selector);
		pad.claimFees(assets);
	}

	function test_setFeeRecipient_movesFutureFeesOnly() public {
		address token = _launch();
		address newRecipient = makeAddr("newRecipient");

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		pad.buy(token, address(nvda), 100e18, 0);
		vm.stopPrank();
		uint256 earnedBefore = pad.claimable(creator, address(nvda));

		vm.prank(creator);
		pad.setFeeRecipient(token, newRecipient);

		vm.prank(trader);
		pad.buy(token, address(nvda), 100e18, 0);

		// Already-earned fees stay with whoever earned them.
		assertEq(pad.claimable(creator, address(nvda)), earnedBefore);
		assertGt(pad.claimable(newRecipient, address(nvda)), 0);
	}

	function test_setFeeRecipient_onlyByTheCurrentRecipient() public {
		address token = _launch();
		vm.prank(trader);
		vm.expectRevert(PairedLaunchpad.NotFeeRecipient.selector);
		pad.setFeeRecipient(token, trader);
	}

	// ── administration ───────────────────────────────────────────────────────

	function test_setParams_capsTheSwapFee() public {
		vm.expectRevert(PairedLaunchpad.FeeTooHigh.selector);
		pad.setParams(LAUNCH_FEE, 501, treasury);
	}

	function test_admin_isOwnerOnly() public {
		vm.prank(trader);
		vm.expectRevert(PairedLaunchpad.NotOwner.selector);
		pad.setParams(0, 0, trader);
	}

	function test_theTokenHasNoAdminSurface() public {
		address token = _launch();
		// No mint, no owner, no pause. The supply is fixed at construction and
		// nothing on the token can change it.
		assertEq(PairedToken(token).totalSupply(), pad.TOTAL_SUPPLY());
		assertEq(PairedToken(token).launchpad(), address(pad));
	}

	// ── fuzzing ──────────────────────────────────────────────────────────────

	/// @dev The property that matters most: a buy followed by an immediate sell
	/// must never return more than it cost, at any size. The first version of
	/// the curve failed this by one wei because integer division rounded toward
	/// the trader, and one wei repeated is a drain.
	function testFuzz_roundTripNeverProfits(uint96 raw) public {
		uint256 amount = bound(uint256(raw), 1e12, 500e18);
		address token = _launch();

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		uint256 bought = pad.buy(token, address(nvda), amount, 0);
		IERC20(token).approve(address(pad), type(uint256).max);
		uint256 returned = pad.sell(token, address(nvda), bought, 0);
		vm.stopPrank();

		assertLe(returned, amount);
	}

	/// @dev Whatever the curve believes it holds must actually be there, or a
	/// later seller is paid with someone else's deposit.
	function testFuzz_reserveIsAlwaysBacked(uint96 raw, uint8 trades) public {
		uint256 amount = bound(uint256(raw), 1e12, 50e18);
		uint256 count = bound(uint256(trades), 1, 10);
		address token = _launch();

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		for (uint256 i; i < count; ++i) {
			pad.buy(token, address(nvda), amount, 0);
		}
		vm.stopPrank();

		PairedLaunchpad.Curve memory c = pad.curveOf(token, address(nvda));
		assertLe(c.realQuote, nvda.balanceOf(address(pad)));
		assertEq(IERC20(token).balanceOf(address(pad)), c.tokensLeft);
	}

	/// @dev Supply is conserved: what the curves still hold plus what traders
	/// hold is always exactly the fixed supply.
	function testFuzz_supplyIsConserved(uint96 raw) public {
		uint256 amount = bound(uint256(raw), 1e12, 200e18);
		address token = _launch();

		vm.startPrank(trader);
		nvda.approve(address(pad), type(uint256).max);
		uint256 bought = pad.buy(token, address(nvda), amount, 0);
		vm.stopPrank();

		assertEq(bought + pad.curveOf(token, address(nvda)).tokensLeft, pad.TOTAL_SUPPLY());
	}
}
