// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ThreeWsUniswapLauncher,
    INonfungiblePositionManager,
    IUniswapV3Factory,
    IUniswapV3Pool,
    TickMath
} from "../src/ThreeWsUniswapLauncher.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// Base mainnet fork tests. Run: forge test --match-contract ThreeWsUniswapLauncherTest -vv
contract ThreeWsUniswapLauncherTest is Test {
    address constant PM = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

    // Price of 1e-8 WETH per token (1 ETH = 100M tokens): ln(1e-8)/ln(1.0001) = -184206.8, aligned
    // down to a multiple of 200 so it is valid for every fee tier.
    int24 constant START_TICK = -184200;
    uint256 constant SUPPLY = 1_000_000_000 ether;
    uint256 constant LAUNCH_FEE = 0.001 ether;

    ThreeWsUniswapLauncher plain; // no treasury, no share
    ThreeWsUniswapLauncher paid; // treasury, 0.001 ETH fee, 10% share

    address creator = makeAddr("tw-launcher-test-creator");
    address feeRecipient = makeAddr("tw-launcher-test-feeRecipient");
    address treasury = makeAddr("tw-launcher-test-treasury");
    address trader = makeAddr("tw-launcher-test-trader");
    address stranger = makeAddr("tw-launcher-test-stranger");

    function setUp() public {
        try vm.createSelectFork("https://mainnet.base.org") returns (uint256) {}
        catch {
            vm.skip(true);
            return;
        }
        plain = new ThreeWsUniswapLauncher(PM, WETH, address(0), 0, 0);
        paid = new ThreeWsUniswapLauncher(PM, WETH, treasury, LAUNCH_FEE, 1000);
    }

    // ---------------------------------------------------------------- helpers

    function _params(uint8 mode, uint24 fee) internal view returns (ThreeWsUniswapLauncher.LaunchParams memory p) {
        p = ThreeWsUniswapLauncher.LaunchParams({
            name: "Fork Token",
            symbol: "FORK",
            fee: fee,
            startTick: START_TICK,
            creator: creator,
            feeRecipient: mode == 0 ? address(0) : feeRecipient,
            lockMode: mode,
            unlockAt: mode == 1 ? uint64(block.timestamp + 30 days) : 0,
            metadataHash: keccak256("meta"),
            metadataURI: "ipfs://meta",
            deadline: block.timestamp + 1 hours
        });
    }

    /// Bump the launcher nonce until the next token address sorts on the requested side of WETH.
    function _forceOrdering(ThreeWsUniswapLauncher l, bool tokenIsToken0) internal returns (address predicted) {
        for (uint256 i; i < 64; i++) {
            predicted = vm.computeCreateAddress(address(l), vm.getNonce(address(l)));
            if ((predicted < WETH) == tokenIsToken0) return predicted;
            vm.setNonce(address(l), uint64(vm.getNonce(address(l)) + 1));
        }
        revert("ordering not found");
    }

    function _launch(ThreeWsUniswapLauncher l, ThreeWsUniswapLauncher.LaunchParams memory p, bool tokenIsToken0)
        internal
        returns (address token, address pool, uint256 tokenId)
    {
        address predicted = _forceOrdering(l, tokenIsToken0);
        (token, pool, tokenId) = l.launch{value: l.launchFeeWei()}(p);
        assertEq(token, predicted, "token address prediction");
    }

    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) internal returns (uint256) {
        vm.startPrank(trader);
        IERC20(tokenIn).approve(ROUTER, amountIn);
        uint256 out = ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(tokenIn, tokenOut, fee, trader, amountIn, 0, 0)
        );
        vm.stopPrank();
        return out;
    }

    function _trade(address token, uint24 fee) internal {
        vm.deal(trader, 10 ether);
        vm.prank(trader);
        IWETH(WETH).deposit{value: 5 ether}();
        uint256 bought = _swap(WETH, token, fee, 2 ether);
        assertGt(bought, 0, "bought");
        _swap(token, WETH, fee, bought / 2);
    }

    // ---------------------------------------------------------------- constants

    function test_forkConstants() public view {
        assertGt(PM.code.length, 0);
        assertGt(FACTORY.code.length, 0);
        assertGt(WETH.code.length, 0);
        assertGt(ROUTER.code.length, 0);
        assertEq(INonfungiblePositionManager(PM).factory(), FACTORY);
        assertEq(INonfungiblePositionManager(PM).WETH9(), WETH);
        assertEq(address(plain.v3Factory()), FACTORY);
    }

    function test_tickMathMatchesKnownValues() public pure {
        assertEq(TickMath.getSqrtRatioAtTick(0), 79228162514264337593543950336);
        assertEq(TickMath.getSqrtRatioAtTick(887272), 1461446703485210103287273052203988822378723970342);
        assertEq(TickMath.getSqrtRatioAtTick(-887272), 4295128739);
    }

    // ---------------------------------------------------------------- mode 0

    function _mode0(bool tokenIsToken0) internal {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(0, 10000);
        (address token, address pool, uint256 tokenId) = _launch(plain, p, tokenIsToken0);

        assertEq(IERC20(token).totalSupply(), SUPPLY);
        assertEq(IUniswapV3Factory(FACTORY).getPool(token, WETH, 10000), pool);
        assertGt(IUniswapV3Pool(pool).liquidity() + _liquidityOf(tokenId), 0);
        assertGt(_liquidityOf(tokenId), 0, "position liquidity");
        assertEq(IERC20(token).balanceOf(address(plain)), 0, "launcher holds no tokens");
        assertEq(INonfungiblePositionManager(PM).ownerOf(tokenId), creator);
        assertApproxEqRel(IERC20(token).balanceOf(pool), SUPPLY, 1e9, "pool holds full supply");
        assertEq(IERC20(token).balanceOf(pool) + IERC20(token).balanceOf(creator), SUPPLY, "dust to creator only");

        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 poolTick = tokenIsToken0 ? START_TICK : -START_TICK;
        assertEq(sqrtP, TickMath.getSqrtRatioAtTick(poolTick));
        (,,address t0,,,,,,,,,) = INonfungiblePositionManager(PM).positions(tokenId);
        assertEq(t0 == token, tokenIsToken0);
    }

    function _liquidityOf(uint256 tokenId) internal view returns (uint128 liq) {
        (,,,,,,, liq,,,,) = INonfungiblePositionManager(PM).positions(tokenId);
    }

    function test_mode0_tokenIsToken0() public {
        _mode0(true);
    }

    function test_mode0_tokenIsToken1() public {
        _mode0(false);
    }

    function test_mode0_emitsLaunched() public {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(0, 3000);
        address token = _forceOrdering(plain, true);
        vm.recordLogs();
        plain.launch(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256(
            "Launched(address,address,uint256,address,address,uint24,uint8,uint64,int24,bytes32,string)"
        );
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(plain) && logs[i].topics[0] == sig) {
                found = true;
                assertEq(address(uint160(uint256(logs[i].topics[1]))), token);
            }
        }
        assertTrue(found, "Launched emitted");
    }

    // ---------------------------------------------------------------- mode 1

    function test_mode1_timelock() public {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(1, 3000);
        (address token,, uint256 tokenId) = _launch(plain, p, true);
        assertEq(INonfungiblePositionManager(PM).ownerOf(tokenId), address(plain));
        assertEq(IERC20(token).balanceOf(address(plain)), 0);

        (address c, address r, uint8 mode, uint64 unlockAt) = plain.positionInfo(tokenId);
        assertEq(c, creator);
        assertEq(r, feeRecipient);
        assertEq(mode, 1);
        assertEq(unlockAt, p.unlockAt);

        vm.prank(creator);
        vm.expectRevert(ThreeWsUniswapLauncher.StillLocked.selector);
        plain.withdraw(tokenId);

        vm.warp(unlockAt);
        vm.prank(stranger);
        vm.expectRevert(ThreeWsUniswapLauncher.NotCreator.selector);
        plain.withdraw(tokenId);

        vm.prank(creator);
        plain.withdraw(tokenId);
        assertEq(INonfungiblePositionManager(PM).ownerOf(tokenId), creator);
        (address cAfter,,,) = plain.positionInfo(tokenId);
        assertEq(cAfter, address(0));
    }

    function test_mode1_tokenIsToken1() public {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(1, 500);
        (, address pool, uint256 tokenId) = _launch(plain, p, false);
        assertGt(_liquidityOf(tokenId), 0);
        assertEq(INonfungiblePositionManager(PM).ownerOf(tokenId), address(plain));
        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(pool).slot0();
        assertEq(sqrtP, TickMath.getSqrtRatioAtTick(-START_TICK));
    }

    // ---------------------------------------------------------------- mode 2

    function test_mode2_permanent() public {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(2, 10000);
        (,, uint256 tokenId) = _launch(plain, p, true);
        assertEq(INonfungiblePositionManager(PM).ownerOf(tokenId), address(plain));

        vm.warp(block.timestamp + 20 * 365 days);
        vm.prank(creator);
        vm.expectRevert(ThreeWsUniswapLauncher.NotWithdrawable.selector);
        plain.withdraw(tokenId);

        address newRecipient = makeAddr("newRecipient");
        vm.prank(stranger);
        vm.expectRevert(ThreeWsUniswapLauncher.NotCreator.selector);
        plain.setFeeRecipient(tokenId, newRecipient);

        vm.prank(creator);
        vm.expectRevert(ThreeWsUniswapLauncher.ZeroAddress.selector);
        plain.setFeeRecipient(tokenId, address(0));

        vm.prank(creator);
        plain.setFeeRecipient(tokenId, newRecipient);
        (, address r, uint8 mode,) = plain.positionInfo(tokenId);
        assertEq(r, newRecipient);
        assertEq(mode, 2);
    }

    // ---------------------------------------------------------------- fees

    function _feesFlow(ThreeWsUniswapLauncher l, uint8 mode, bool tokenIsToken0, uint256 bps) internal {
        (address token,, uint256 tokenId) = _launch(l, _params(mode, 10000), tokenIsToken0);
        _trade(token, 10000);

        uint256 wethBefore = IERC20(WETH).balanceOf(feeRecipient);
        uint256 tokBefore = IERC20(token).balanceOf(feeRecipient);
        (uint256 a0, uint256 a1) = l.collectFees(tokenId);
        (uint256 wethAmt, uint256 tokAmt) = tokenIsToken0 ? (a1, a0) : (a0, a1);
        assertGt(wethAmt, 0, "weth fees");
        assertGt(tokAmt, 0, "token fees");

        _assertSplit(IERC20(WETH), wethAmt, bps, wethBefore);
        _assertSplit(IERC20(token), tokAmt, bps, tokBefore);
        assertEq(IERC20(WETH).balanceOf(address(l)), 0);
        assertEq(IERC20(token).balanceOf(address(l)), 0);
    }

    function _assertSplit(IERC20 t, uint256 amount, uint256 bps, uint256 recipientBefore)
        internal
        view
    {
        uint256 platform = amount * bps / 10_000;
        assertEq(t.balanceOf(feeRecipient) - recipientBefore, amount - platform, "recipient share");
        assertEq(t.balanceOf(treasury), platform, "platform share");
        if (bps != 0) assertGt(platform, 0);
    }

    function test_fees_withPlatformShare_tokenIs0() public {
        _feesFlow(paid, 1, true, 1000);
    }

    function test_fees_withPlatformShare_tokenIs1() public {
        _feesFlow(paid, 2, false, 1000);
    }

    function test_fees_noShare() public {
        _feesFlow(plain, 2, true, 0);
        _feesFlow(plain, 1, false, 0);
    }

    function test_collectFees_unknownPositionReverts() public {
        vm.expectRevert(ThreeWsUniswapLauncher.UnknownPosition.selector);
        plain.collectFees(1);
    }

    // ---------------------------------------------------------------- launch fee

    function test_launchFee() public {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(0, 3000);
        vm.deal(address(this), 1 ether);

        vm.expectRevert(ThreeWsUniswapLauncher.WrongLaunchFee.selector);
        paid.launch{value: LAUNCH_FEE - 1}(p);
        vm.expectRevert(ThreeWsUniswapLauncher.WrongLaunchFee.selector);
        paid.launch{value: LAUNCH_FEE + 1}(p);
        vm.expectRevert(ThreeWsUniswapLauncher.WrongLaunchFee.selector);
        paid.launch(p);
        vm.expectRevert(ThreeWsUniswapLauncher.WrongLaunchFee.selector);
        plain.launch{value: 1}(p);

        uint256 before_ = treasury.balance;
        paid.launch{value: LAUNCH_FEE}(p);
        assertEq(treasury.balance - before_, LAUNCH_FEE);
        assertEq(address(paid).balance, 0);
    }

    // ---------------------------------------------------------------- invalid inputs

    function test_invalidInputs() public {
        ThreeWsUniswapLauncher.LaunchParams memory p;

        p = _params(0, 2500);
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidFeeTier.selector);
        plain.launch(p);

        p = _params(0, 10000);
        p.startTick = START_TICK + 1; // not a multiple of 200
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidStartTick.selector);
        plain.launch(p);

        p = _params(0, 10000);
        p.startTick = 887200; // equals max usable tick for spacing 200
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidStartTick.selector);
        plain.launch(p);

        p = _params(0, 10000);
        p.startTick = -887400;
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidStartTick.selector);
        plain.launch(p);

        p = _params(0, 10000);
        p.deadline = block.timestamp - 1;
        vm.expectRevert(ThreeWsUniswapLauncher.DeadlinePassed.selector);
        plain.launch(p);

        p = _params(1, 10000);
        p.unlockAt = uint64(block.timestamp + 1 days - 1);
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidUnlockAt.selector);
        plain.launch(p);

        p = _params(1, 10000);
        p.unlockAt = uint64(block.timestamp + 3650 days + 1);
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidUnlockAt.selector);
        plain.launch(p);

        p = _params(1, 10000);
        p.unlockAt = 0;
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidUnlockAt.selector);
        plain.launch(p);

        p = _params(2, 10000);
        p.feeRecipient = address(0);
        vm.expectRevert(ThreeWsUniswapLauncher.FeeRecipientRequired.selector);
        plain.launch(p);

        p = _params(1, 10000);
        p.feeRecipient = address(0);
        vm.expectRevert(ThreeWsUniswapLauncher.FeeRecipientRequired.selector);
        plain.launch(p);

        p = _params(3, 10000);
        vm.expectRevert(ThreeWsUniswapLauncher.InvalidLockMode.selector);
        plain.launch(p);

        p = _params(0, 10000);
        p.creator = address(0);
        vm.expectRevert(ThreeWsUniswapLauncher.ZeroAddress.selector);
        plain.launch(p);
    }

    function test_constructorValidation() public {
        vm.expectRevert(ThreeWsUniswapLauncher.PlatformShareTooHigh.selector);
        new ThreeWsUniswapLauncher(PM, WETH, treasury, 0, 2001);
        vm.expectRevert(ThreeWsUniswapLauncher.TreasuryRequiredForFees.selector);
        new ThreeWsUniswapLauncher(PM, WETH, address(0), 1, 0);
        vm.expectRevert(ThreeWsUniswapLauncher.TreasuryRequiredForFees.selector);
        new ThreeWsUniswapLauncher(PM, WETH, address(0), 0, 1);
        new ThreeWsUniswapLauncher(PM, WETH, treasury, 0, 2000);
    }

    // ---------------------------------------------------------------- front-run

    /// The token address is the launcher's next CREATE address, so an attacker can pre-create and
    /// initialise the pool at a hostile price before the launch lands. The launch must revert.
    function test_poolPriceMoved_whenPoolFrontRun() public {
        for (uint256 i; i < 2; i++) {
            bool tokenIsToken0 = i == 0;
            address token = _forceOrdering(plain, tokenIsToken0);
            (address t0, address t1) = tokenIsToken0 ? (token, WETH) : (WETH, token);
            uint160 hostile = TickMath.getSqrtRatioAtTick(tokenIsToken0 ? int24(-100000) : int24(100000));
            vm.prank(makeAddr("attacker"));
            INonfungiblePositionManager(PM).createAndInitializePoolIfNecessary(t0, t1, 10000, hostile);

            ThreeWsUniswapLauncher.LaunchParams memory p = _params(0, 10000);
            vm.expectRevert(ThreeWsUniswapLauncher.PoolPriceMoved.selector);
            plain.launch(p);

            // A different fee tier is unaffected by the poisoned tier.
            p.fee = 3000;
            (address deployed,,) = plain.launch(p);
            assertEq(deployed, token);
        }
    }

    // ---------------------------------------------------------------- NFT custody

    function test_rejectsStrayNFTs() public {
        ThreeWsUniswapLauncher.LaunchParams memory p = _params(2, 10000);
        (,, uint256 tokenId) = _launch(plain, p, true);
        // The only way an NFT reaches the launcher is the PM minting it mid-launch; a safe transfer
        // of anything else is refused, so nothing can be stranded or spoofed.
        vm.prank(address(plain));
        vm.expectRevert();
        INonfungiblePositionManager(PM).safeTransferFrom(address(plain), address(plain), tokenId);

        vm.prank(stranger);
        vm.expectRevert(ThreeWsUniswapLauncher.UnexpectedNFT.selector);
        plain.onERC721Received(address(plain), address(0), 1, "");
    }

    // ---------------------------------------------------------------- gas

    function test_gas_mode0_and_mode1() public {
        _forceOrdering(plain, true);
        uint256 g = gasleft();
        plain.launch(_params(0, 10000));
        emit log_named_uint("gas launch mode0", g - gasleft());

        _forceOrdering(plain, true);
        g = gasleft();
        plain.launch(_params(1, 10000));
        emit log_named_uint("gas launch mode1", g - gasleft());
    }
}
