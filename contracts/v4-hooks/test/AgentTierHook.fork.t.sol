// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {AgentTierHook} from "../src/AgentTierHook.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";
import {AttributedRouter} from "./AttributedRouter.sol";

contract PairToken is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {
        _mint(msg.sender, 1e30);
    }
}

interface IReputationClients {
    function getClients(uint256 agentId) external view returns (address[] memory);
}

/// Runs on a fork of Base against the LIVE Uniswap v4 PoolManager and the LIVE canonical
/// ERC-8004 registries. Nothing about the registries is simulated: the point of this hook
/// is reading them correctly, and a stand-in that accepted an empty reviewer list is
/// exactly how the one earlier ERC-8004 hook shipped a discount that can never fire.
///
///   BASE_RPC_URL=https://base-rpc.publicnode.com forge test --match-contract AgentTierHookForkTest
contract AgentTierHookForkTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    IERC8004Identity constant IDENTITY = IERC8004Identity(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);
    IERC8004Reputation constant REPUTATION = IERC8004Reputation(0x8004BAa17C55a88189AE136b182e5fdA19dE9b63);
    uint256 constant AGENT_ID = 1;

    // beforeInitialize | beforeSwap
    uint160 constant FLAGS = (1 << 13) | (1 << 7);
    uint24 constant BASE_FEE = 10_000; // 1%
    uint24 constant AGENT_FEE = 5_000; // 0.5%
    uint24 constant TRUSTED_FEE = 1_000; // 0.1%

    bool forked;
    AgentTierHook hook;
    AttributedRouter router;
    PoolSwapTest plainRouter;
    PoolModifyLiquidityTest liquidityRouter;
    PoolKey key;
    PoolId poolId;
    Currency currency0;
    Currency currency1;

    address agentOwner;
    address[] reviewers;
    uint64 liveCount;
    int256 liveScore;
    address stranger = makeAddr("stranger");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        try vm.createSelectFork(rpc) {
            forked = true;
        } catch {
            return;
        }

        agentOwner = IDENTITY.ownerOf(AGENT_ID);
        address[] memory clients = IReputationClients(address(REPUTATION)).getClients(AGENT_ID);
        for (uint256 i; i < clients.length && i < 16; ++i) {
            reviewers.push(clients[i]);
        }
        (uint64 count, int128 value, uint8 decimals) = REPUTATION.getSummary(AGENT_ID, reviewers, "", "");
        liveCount = count;
        liveScore = int256(value) * int256(10 ** uint256(18 - decimals));

        address hookAddr = address(uint160(uint256(0x8004) << 144) | FLAGS);
        deployCodeTo("AgentTierHook.sol:AgentTierHook", abi.encode(MANAGER, IDENTITY, REPUTATION), hookAddr);
        hook = AgentTierHook(hookAddr);

        router = new AttributedRouter(MANAGER);
        plainRouter = new PoolSwapTest(MANAGER);
        liquidityRouter = new PoolModifyLiquidityTest(MANAGER);

        PairToken a = new PairToken("AAA");
        PairToken b = new PairToken("BBB");
        (currency0, currency1) = address(a) < address(b)
            ? (Currency.wrap(address(a)), Currency.wrap(address(b)))
            : (Currency.wrap(address(b)), Currency.wrap(address(a)));

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        key = hook.createPool(currency0, currency1, 60, TickMath.getSqrtPriceAtTick(0), _config(liveScore), reviewers, routers);
        poolId = key.toId();

        a.approve(address(liquidityRouter), type(uint256).max);
        b.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e24, salt: 0}),
            ""
        );

        address[3] memory traders = [agentOwner, stranger, address(this)];
        for (uint256 i; i < traders.length; ++i) {
            if (traders[i] != address(this)) {
                a.transfer(traders[i], 1e24);
                b.transfer(traders[i], 1e24);
            }
            vm.startPrank(traders[i]);
            a.approve(address(router), type(uint256).max);
            b.approve(address(router), type(uint256).max);
            a.approve(address(plainRouter), type(uint256).max);
            b.approve(address(plainRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _config(int256 minScore) internal view returns (AgentTierHook.TierConfig memory) {
        return AgentTierHook.TierConfig({
            baseFee: BASE_FEE,
            agentFee: AGENT_FEE,
            trustedFee: TRUSTED_FEE,
            minCount: liveCount,
            minScore: minScore,
            ttl: 1 days,
            tag1: "",
            tag2: ""
        });
    }

    /// Output of selling a fixed 1e18 of currency0. The pool is restored between calls, so
    /// a larger output means a smaller LP fee was charged.
    function _sell(address trader, bytes memory hookData) internal returns (uint256 out) {
        uint256 snapshot = vm.snapshotState();
        vm.prank(trader);
        BalanceDelta delta = router.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            hookData
        );
        out = uint256(uint128(delta.amount1()));
        vm.revertToState(snapshot);
    }

    function test_liveRegistryStillRefusesAnEmptyReviewerList() public {
        vm.skip(!forked);
        vm.expectRevert(bytes("clientAddresses required"));
        REPUTATION.getSummary(AGENT_ID, new address[](0), "", "");
        assertGt(liveCount, 0, "agent #1 has feedback from the reviewer set");
    }

    function test_threeTiers_againstLiveRegistries() public {
        vm.skip(!forked);
        bytes memory asAgent = abi.encode(AGENT_ID);

        assertEq(hook.quoteFee(poolId, stranger, AGENT_ID), BASE_FEE, "naming an agent you do not control");
        assertEq(hook.quoteFee(poolId, agentOwner, AGENT_ID), AGENT_FEE, "registered, tier not refreshed yet");

        assertTrue(hook.refreshTier(poolId, AGENT_ID), "live reputation clears a bar set at its own value");
        assertEq(hook.quoteFee(poolId, agentOwner, AGENT_ID), TRUSTED_FEE);
        assertEq(hook.quoteFee(poolId, stranger, AGENT_ID), BASE_FEE, "someone else's standing is not yours");

        // The fee tiers are real: the same trade returns more as the fee drops.
        uint256 strangerOut = _sell(stranger, asAgent);
        uint256 noHookDataOut = _sell(agentOwner, "");
        uint256 trustedOut = _sell(agentOwner, asAgent);
        assertEq(strangerOut, noHookDataOut, "both pay the base fee");
        assertGt(trustedOut, strangerOut);
        // 1e18 in at price 1 with deep liquidity: outputs differ by the fee gap, 0.9%.
        assertApproxEqRel(trustedOut - strangerOut, 0.009e18, 0.01e18);
    }

    function test_tierExpires_andFallsBackToAgentFee() public {
        vm.skip(!forked);
        hook.refreshTier(poolId, AGENT_ID);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(hook.quoteFee(poolId, agentOwner, AGENT_ID), AGENT_FEE);
    }

    function test_barAboveLiveScore_isNotTrusted_andConfigChangeVoidsCache() public {
        vm.skip(!forked);
        hook.refreshTier(poolId, AGENT_ID);
        assertEq(hook.quoteFee(poolId, agentOwner, AGENT_ID), TRUSTED_FEE);

        hook.setConfig(poolId, _config(liveScore + 1), reviewers);
        assertEq(hook.quoteFee(poolId, agentOwner, AGENT_ID), AGENT_FEE, "old cache entry is void");
        assertFalse(hook.refreshTier(poolId, AGENT_ID));
        assertEq(hook.quoteFee(poolId, agentOwner, AGENT_ID), AGENT_FEE);
    }

    function test_untrustedRouterAlwaysPaysBaseFee() public {
        vm.skip(!forked);
        hook.refreshTier(poolId, AGENT_ID);
        hook.setTrustedRouter(poolId, address(router), false);

        uint256 untrusted = _sell(agentOwner, abi.encode(AGENT_ID));
        hook.setTrustedRouter(poolId, address(router), true);
        uint256 trusted = _sell(agentOwner, abi.encode(AGENT_ID));
        assertGt(trusted, untrusted);
    }

    function test_routerWithoutMsgSender_andMalformedHookData_swapAtBaseFee() public {
        vm.skip(!forked);
        hook.setTrustedRouter(poolId, address(plainRouter), true);
        plainRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            abi.encode(AGENT_ID)
        );
        assertEq(_sell(agentOwner, hex"deadbeef"), _sell(stranger, ""));
    }

    function test_brokenRegistry_costsTheDiscount_neverTheSwap() public {
        vm.skip(!forked);
        hook.refreshTier(poolId, AGENT_ID);
        uint256 baseline = _sell(stranger, "");

        // Replace both registries with code that reverts on every call.
        vm.etch(address(IDENTITY), hex"60006000fd");
        vm.etch(address(REPUTATION), hex"60006000fd");
        assertEq(_sell(agentOwner, abi.encode(AGENT_ID)), baseline, "swap works, at the base fee");
        assertFalse(hook.refreshTier(poolId, AGENT_ID), "refresh records no trust instead of reverting");
    }

    function test_onlyTheHookCreatesPools_andOnlyAdminConfigures() public {
        vm.skip(!forked);
        PoolKey memory rogue = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });
        vm.expectRevert();
        MANAGER.initialize(rogue, TickMath.getSqrtPriceAtTick(0));

        vm.startPrank(stranger);
        vm.expectRevert(AgentTierHook.NotPoolAdmin.selector);
        hook.setTrustedRouter(poolId, stranger, true);
        vm.expectRevert(AgentTierHook.NotPoolAdmin.selector);
        hook.setConfig(poolId, _config(0), reviewers);
        vm.stopPrank();
    }

    function test_rejectsBadConfig() public {
        vm.skip(!forked);
        address[] memory none = new address[](0);
        AgentTierHook.TierConfig memory config = _config(0);

        vm.expectRevert(AgentTierHook.InvalidReviewers.selector);
        hook.setConfig(poolId, config, none);

        config.agentFee = BASE_FEE + 1;
        vm.expectRevert(AgentTierHook.InvalidFees.selector);
        hook.setConfig(poolId, config, reviewers);

        config = _config(0);
        config.ttl = 10 minutes;
        vm.expectRevert(AgentTierHook.InvalidTtl.selector);
        hook.setConfig(poolId, config, reviewers);
    }
}
