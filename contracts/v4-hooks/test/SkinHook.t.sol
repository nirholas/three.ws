// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {SkinHook} from "../src/SkinHook.sol";
import {SkinToken} from "../src/SkinToken.sol";

contract NotASkinToken is ERC20 {
    constructor() ERC20("Other", "OTHER") {
        _mint(msg.sender, 10e18);
    }
}

/// Runs against the real v4-core PoolManager and its reference swap router.
contract SkinHookTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta | afterSwapReturnsDelta
    uint160 constant FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);
    int24 constant START_TICK = 92_200; // about 10,100 tokens per ETH

    PoolManager manager;
    PoolSwapTest router;
    SkinHook hook;
    SkinToken token;
    PoolKey key;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address referrer = makeAddr("referrer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        manager = new PoolManager(owner);
        router = new PoolSwapTest(manager);

        address hookAddr = address(uint160(uint256(0x3333) << 144) | FLAGS);
        deployCodeTo("SkinHook.sol:SkinHook", abi.encode(manager, owner, treasury), hookAddr);
        hook = SkinHook(payable(hookAddr));

        (token, key) = hook.launch(_params("Halo", "HALO", 10_000));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _params(string memory name, string memory symbol, uint256 supply)
        internal
        view
        returns (SkinHook.LaunchParams memory)
    {
        return SkinHook.LaunchParams({
            name: name,
            symbol: symbol,
            supply: supply,
            modelURI: "https://three.ws/cdn/skins/halo.glb",
            modelHash: keccak256("halo-glb-bytes"),
            slot: "head",
            startTick: START_TICK,
            creator: creator
        });
    }

    // ------------------------------------------------------------------ helpers

    function _swap(address who, bool buy, int256 amountSpecified, uint256 value, bytes memory hookData)
        internal
        returns (BalanceDelta delta)
    {
        vm.prank(who);
        delta = router.swap{value: value}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: buy,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    function _buy(address who, uint256 ethIn, bytes memory hookData) internal returns (BalanceDelta) {
        return _swap(who, true, -int256(ethIn), ethIn, hookData);
    }

    function _totalOwed() internal view returns (uint256) {
        return hook.owed(creator) + hook.owed(referrer) + hook.owed(treasury);
    }

    // ------------------------------------------------------------------ launch

    function test_launch_seedsEntireSupplyAndKeepsNothing() public view {
        assertEq(token.totalSupply(), 10_000e18);
        assertEq(token.balanceOf(address(hook)), 0, "hook holds only equipped tokens");
        assertEq(token.balanceOf(creator), 0, "no creator allocation");
        assertEq(token.balanceOf(treasury), 0, "no platform allocation");
        // Rounding dust is burned; everything else is in the pool.
        assertApproxEqAbs(token.balanceOf(address(manager)), 10_000e18, 1e6);
        assertTrue(hook.isSkin(token));
        assertEq(token.creator(), creator);
        assertEq(token.modelHash(), keccak256("halo-glb-bytes"));

        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertEq(tick, START_TICK);
    }

    function test_launch_rejectsBadParams() public {
        SkinHook.LaunchParams memory p = _params("X", "X", 99);
        vm.expectRevert(SkinHook.InvalidSupply.selector);
        hook.launch(p);

        p = _params("X", "X", 1_000_001);
        vm.expectRevert(SkinHook.InvalidSupply.selector);
        hook.launch(p);

        p = _params("X", "X", 1000);
        p.startTick = 92_201;
        vm.expectRevert(SkinHook.InvalidStartTick.selector);
        hook.launch(p);

        p.startTick = 200;
        vm.expectRevert(SkinHook.InvalidStartTick.selector);
        hook.launch(p);

        p = _params("X", "X", 1000);
        p.modelHash = bytes32(0);
        vm.expectRevert(SkinHook.InvalidModel.selector);
        hook.launch(p);

        p = _params("X", "X", 1000);
        p.creator = address(0);
        vm.expectRevert(SkinHook.ZeroAddress.selector);
        hook.launch(p);
    }

    function test_outsiderCannotInitializeAPoolWithThisHook() public {
        NotASkinToken other = new NotASkinToken();
        PoolKey memory rogue = PoolKey({
            currency0: key.currency0,
            currency1: Currency.wrap(address(other)),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(address(hook))
        });
        vm.expectRevert();
        manager.initialize(rogue, TickMath.getSqrtPriceAtTick(START_TICK));
    }

    // ------------------------------------------------------------------ fees

    /// The very first buy happens while the PoolManager holds no ETH at all. Fees are
    /// ERC-6909 claims, so this works; a hook that called `take` in beforeSwap would not.
    function test_buyExactInput_takesTwoPercentOfEthIn_noReferrer() public {
        assertEq(address(manager).balance, 0);
        _buy(alice, 1 ether, "");

        assertGt(token.balanceOf(alice), 0);
        assertEq(hook.owed(creator), 0.015 ether, "creator gets own share plus the unused referrer share");
        assertEq(hook.owed(treasury), 0.005 ether);
        assertEq(hook.owed(referrer), 0);
    }

    function test_buyExactInput_paysReferrer() public {
        _buy(alice, 1 ether, abi.encode(referrer));
        assertEq(hook.owed(creator), 0.01 ether);
        assertEq(hook.owed(referrer), 0.005 ether);
        assertEq(hook.owed(treasury), 0.005 ether);
    }

    function test_buyExactOutput_feeIsOnTopOfEthPaid() public {
        uint256 before = alice.balance;
        _swap(alice, true, int256(50e18), 1 ether, abi.encode(referrer));
        assertEq(token.balanceOf(alice), 50e18);

        uint256 paid = before - alice.balance;
        uint256 fee = _totalOwed();
        // paid = ethToPool + fee, and fee = 2% of ethToPool
        assertApproxEqAbs(fee, (paid - fee) * 200 / 10_000, 1);
    }

    function test_sellExactInput_feeComesOutOfEthReceived() public {
        _buy(alice, 1 ether, "");
        uint256 owedBefore = _totalOwed();
        uint256 tokens = token.balanceOf(alice);

        vm.prank(alice);
        token.approve(address(router), type(uint256).max);
        uint256 before = alice.balance;
        _swap(alice, false, -int256(tokens / 2), 0, "");

        uint256 received = alice.balance - before;
        uint256 fee = _totalOwed() - owedBefore;
        assertGt(received, 0);
        assertApproxEqAbs(fee, (received + fee) * 200 / 10_000, 1);
    }

    function test_sellExactOutput_ethIsSpecified() public {
        _buy(alice, 1 ether, "");
        uint256 owedBefore = _totalOwed();

        vm.prank(alice);
        token.approve(address(router), type(uint256).max);
        uint256 before = alice.balance;
        _swap(alice, false, int256(0.1 ether), 0, "");

        assertEq(alice.balance - before, 0.1 ether, "seller receives exactly what they asked for");
        assertEq(_totalOwed() - owedBefore, 0.002 ether);
    }

    function test_malformedHookDataNeverRevertsASwap() public {
        _buy(alice, 0.1 ether, hex"01");
        _buy(alice, 0.1 ether, abi.encode(referrer, uint256(7)));
        // 32 bytes, but with dirty upper bits: not an address, so no referrer.
        _buy(alice, 0.1 ether, abi.encode(uint256(type(uint256).max)));
        assertEq(hook.owed(referrer), 0);
        assertEq(hook.owed(creator), 0.0045 ether);
    }

    function test_claim_paysOutEthOnce() public {
        _buy(alice, 1 ether, abi.encode(referrer));

        address payout = makeAddr("payout");
        vm.prank(creator);
        uint256 amount = hook.claim(payout);
        assertEq(amount, 0.01 ether);
        assertEq(payout.balance, 0.01 ether);
        assertEq(hook.owed(creator), 0);

        vm.prank(creator);
        vm.expectRevert(SkinHook.NothingToClaim.selector);
        hook.claim(payout);

        vm.prank(referrer);
        hook.claim(referrer);
        assertEq(referrer.balance, 0.005 ether);
    }

    function test_treasuryIsOwnerControlled() public {
        address next = makeAddr("next");
        vm.prank(alice);
        vm.expectRevert();
        hook.setTreasury(next);

        vm.prank(owner);
        hook.setTreasury(next);
        _buy(alice, 1 ether, "");
        assertEq(hook.owed(next), 0.005 ether);
        assertEq(hook.owed(treasury), 0);
    }

    /// Every wei of fee the hook books is backed by a claim it holds on the PoolManager.
    function testFuzz_owedIsAlwaysBackedByClaims(uint96 ethIn, uint8 sellPct, bool withReferrer) public {
        ethIn = uint96(bound(ethIn, 1e12, 50 ether));
        bytes memory hookData = withReferrer ? abi.encode(referrer) : bytes("");
        _buy(alice, ethIn, hookData);

        uint256 tokens = token.balanceOf(alice) * (uint256(sellPct) % 101) / 100;
        if (tokens > 0) {
            vm.prank(alice);
            token.approve(address(router), type(uint256).max);
            _swap(alice, false, -int256(tokens), 0, hookData);
        }
        assertEq(manager.balanceOf(address(hook), 0), _totalOwed());
    }

    // ------------------------------------------------------------------ wear-to-lock

    function test_equipLocksOneTokenAndUnequipReturnsIt() public {
        _buy(alice, 1 ether, "");
        uint256 balance = token.balanceOf(alice);

        vm.startPrank(alice);
        token.approve(address(hook), type(uint256).max);
        hook.equip(token);
        vm.stopPrank();

        assertTrue(hook.isWearing(token, alice));
        assertEq(hook.wearerCount(token), 1);
        assertEq(token.balanceOf(alice), balance - 1e18);
        assertEq(token.balanceOf(address(hook)), 1e18, "the locked token is out of the float");

        vm.prank(alice);
        vm.expectRevert(SkinHook.AlreadyWearing.selector);
        hook.equip(token);

        vm.prank(alice);
        hook.unequip(token);
        assertFalse(hook.isWearing(token, alice));
        assertEq(hook.wearerCount(token), 0);
        assertEq(token.balanceOf(alice), balance);

        vm.prank(alice);
        vm.expectRevert(SkinHook.NotWearing.selector);
        hook.unequip(token);
    }

    function test_equipNeedsAWholeToken() public {
        _buy(bob, 0.00001 ether, "");
        assertLt(token.balanceOf(bob), 1e18);
        vm.startPrank(bob);
        token.approve(address(hook), type(uint256).max);
        vm.expectRevert();
        hook.equip(token);
        vm.stopPrank();
    }

    function test_equipRejectsTokensThisHookDidNotLaunch() public {
        NotASkinToken other = new NotASkinToken();
        other.approve(address(hook), type(uint256).max);
        vm.expectRevert(SkinHook.NotASkin.selector);
        hook.equip(SkinToken(address(other)));
    }

    function test_wearersOfOneSkinDoNotAffectAnother() public {
        (SkinToken cape,) = hook.launch(_params("Cape", "CAPE", 500));
        _buy(alice, 1 ether, "");
        vm.startPrank(alice);
        token.approve(address(hook), type(uint256).max);
        hook.equip(token);
        vm.stopPrank();
        assertEq(hook.wearerCount(token), 1);
        assertEq(hook.wearerCount(cape), 0);
        assertEq(cape.balanceOf(address(hook)), 0);
    }
}
