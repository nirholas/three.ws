// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Portfolio} from "../src/Portfolio.sol";
import {PortfolioRegistry} from "../src/PortfolioRegistry.sol";
import {PortfolioFactory} from "../src/PortfolioFactory.sol";
import {TestToken, PlainToken} from "./TestToken.sol";

/// @notice Shared fixture: a registry, an attester, a factory and a three-leg cross-class portfolio.
contract PortfolioFixture is Test {
    PortfolioRegistry internal registry;
    PortfolioFactory internal factory;
    Portfolio internal portfolio;

    // The three asset classes the product spans, in the proportions a generated manifest produces.
    TestToken internal nvda; // tokenized equity: has the issuer's halt switch
    PlainToken internal weth; // major: no halt switch
    PlainToken internal meme; // long tail: no halt switch

    uint256 internal attesterKey = 0xA11CE;
    address internal attester;
    address internal owner = address(0xB0B);
    address internal creator = address(0xC0FFEE);
    address internal alice = address(0xA11);
    address internal filler = address(0xF111);

    uint256 internal manifestId;

    function setUp() public virtual {
        attester = vm.addr(attesterKey);
        registry = new PortfolioRegistry(owner, attester);
        factory = new PortfolioFactory(address(registry));
        vm.prank(owner);
        registry.setFactory(address(factory), true);

        nvda = new TestToken("NVIDIA Robinhood Token", "NVDA", 18);
        weth = new PlainToken("Wrapped Ether", "WETH");
        meme = new PlainToken("Cash Cat", "CASHCAT");

        manifestId = _publish(keccak256("manifest-v1"), 0, creator);
        portfolio = Portfolio(_deploy(manifestId, "AI Infrastructure", "AIINF"));

        _fund(alice);
        _fund(filler);
    }

    function _constituents() internal view returns (address[] memory c) {
        c = new address[](3);
        c[0] = address(nvda);
        c[1] = address(weth);
        c[2] = address(meme);
    }

    function _seedUnits() internal pure returns (uint256[] memory u) {
        u = new uint256[](3);
        u[0] = 0.5e18;
        u[1] = 0.25e18;
        u[2] = 100e18;
    }

    /// @dev Builds the attestation signature without touching the registry's state, so a test can
    /// place `vm.expectRevert` immediately before the `publish` call it is actually asserting on.
    function _sign(bytes32 hash_, uint256 parent, address who, uint256 deadline, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(registry.ATTESTATION_TYPEHASH(), hash_, who, parent, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _domain(structHash));
        return abi.encodePacked(r, s, v);
    }

    function _publish(bytes32 hash_, uint256 parent, address who) internal returns (uint256 id) {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _sign(hash_, parent, who, deadline, attesterKey);
        vm.prank(who);
        id = registry.publish(hash_, "ipfs://manifest", parent, deadline, sig);
    }

    function _domain(bytes32 structHash) internal view returns (bytes32) {
        (, string memory name_, string memory version_, uint256 chainId, address verifying,,) = registry.eip712Domain();
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name_)),
                keccak256(bytes(version_)),
                chainId,
                verifying
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _deploy(uint256 id, string memory name_, string memory symbol_) internal returns (address) {
        Portfolio.Config memory c = Portfolio.Config({
            name: name_,
            symbol: symbol_,
            registry: address(registry),
            manifestId: id,
            constituents: _constituents(),
            seedUnits: _seedUnits(),
            feeBps: 100, // 1% a year
            rebalanceInterval: 30 days,
            rebalanceDelay: 1 days,
            auctionDuration: 6 hours,
            startPayoutBps: 9_700,
            endPayoutBps: 10_000
        });
        address whoCreated = registry.manifest(id).creator;
        vm.prank(whoCreated);
        return factory.deploy(c);
    }

    function _fund(address who) internal {
        nvda.mint(who, 1_000_000e18);
        weth.mint(who, 1_000_000e18);
        meme.mint(who, 100_000_000e18);
        vm.startPrank(who);
        nvda.approve(address(portfolio), type(uint256).max);
        weth.approve(address(portfolio), type(uint256).max);
        meme.approve(address(portfolio), type(uint256).max);
        vm.stopPrank();
    }

    function _maxes() internal pure returns (uint256[] memory m) {
        m = new uint256[](3);
        m[0] = type(uint256).max;
        m[1] = type(uint256).max;
        m[2] = type(uint256).max;
    }

    function _zeros() internal pure returns (uint256[] memory z) {
        z = new uint256[](3);
    }

    function _issue(address who, uint256 shares) internal returns (uint256[] memory) {
        vm.prank(who);
        return portfolio.issue(shares, _maxes(), who);
    }
}

contract PortfolioIssuanceTest is PortfolioFixture {
    function test_firstIssuanceDeliversSeedUnitsAndLocksMinimum() public {
        uint256 shares = 100e18;
        uint256[] memory amounts = _issue(alice, shares);

        assertEq(amounts[0], 50e18, "nvda");
        assertEq(amounts[1], 25e18, "weth");
        assertEq(amounts[2], 10_000e18, "meme");
        assertEq(portfolio.totalSupply(), shares, "supply");
        assertEq(portfolio.balanceOf(alice), shares - portfolio.MINIMUM_LIQUIDITY(), "alice shares");
        assertEq(portfolio.balanceOf(address(0xdead)), portfolio.MINIMUM_LIQUIDITY(), "locked");
    }

    function test_secondIssuanceIsPricedOffBalancesNotSeed() public {
        _issue(alice, 100e18);
        // A donation straight to the vault raises the backing of every existing share. The next
        // issuer must deliver at the NEW ratio, otherwise they would mint against the donation.
        nvda.mint(address(portfolio), 50e18);

        uint256[] memory amounts = _issue(filler, 100e18);
        assertEq(amounts[0], 100e18, "must pay the donated ratio, not the seed ratio");
    }

    function test_issueRespectsMaxAmounts() public {
        uint256[] memory maxes = _maxes();
        maxes[0] = 1e18;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.DeliverExceedsMax.selector, address(nvda), 50e18, 1e18));
        portfolio.issue(100e18, maxes, alice);
    }

    function test_redeemReturnsProRata() public {
        _issue(alice, 100e18);
        uint256 before = nvda.balanceOf(alice);

        vm.prank(alice);
        uint256[] memory out = portfolio.redeem(50e18, _zeros(), alice);

        assertEq(out[0], 25e18, "half the nvda");
        assertEq(nvda.balanceOf(alice) - before, 25e18, "received");
        assertEq(portfolio.totalSupply(), 50e18, "supply burned");
    }

    function test_redeemRespectsMinAmounts() public {
        _issue(alice, 100e18);
        uint256[] memory mins = _zeros();
        mins[0] = 26e18;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.ReceiveBelowMin.selector, address(nvda), 25e18, 26e18));
        portfolio.redeem(50e18, mins, alice);
    }

    /// @dev The invariant the whole in-kind design exists to hold: a round trip can never return
    /// more than it delivered, at any size, so there is no mint/redeem asymmetry to extract NAV
    /// through. Deliveries round up and payouts round down, so the vault keeps every rounding.
    function testFuzz_roundTripNeverProfits(uint256 seedShares, uint256 tripShares) public {
        seedShares = bound(seedShares, 1e16, 1_000e18);
        tripShares = bound(tripShares, 1, 1_000e18);

        _issue(alice, seedShares);

        uint256[] memory beforeBal = new uint256[](3);
        address[] memory cs = _constituents();
        for (uint256 i; i < 3; ++i) {
            beforeBal[i] = IERC20(cs[i]).balanceOf(filler);
        }

        vm.startPrank(filler);
        portfolio.issue(tripShares, _maxes(), filler);
        portfolio.redeem(portfolio.balanceOf(filler), _zeros(), filler);
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            assertLe(IERC20(cs[i]).balanceOf(filler), beforeBal[i], "round trip must not profit");
        }
    }

    /// @dev Backing is derived from balances, so this must hold after every operation without any
    /// code asserting it: the vault always holds at least what its shares claim.
    function testFuzz_backingCoversSupply(uint256 a, uint256 b) public {
        a = bound(a, 1e16, 10_000e18);
        b = bound(b, 1e16, 10_000e18);
        _issue(alice, a);
        _issue(filler, b);

        uint256[] memory units = portfolio.unitsPerShare();
        uint256 supply = portfolio.totalSupply();
        address[] memory cs = _constituents();
        for (uint256 i; i < 3; ++i) {
            assertGe(
                IERC20(cs[i]).balanceOf(address(portfolio)) * 1e18,
                units[i] * supply,
                "balance must cover the units its shares claim"
            );
        }
    }
}

contract PortfolioHaltTest is PortfolioFixture {
    function test_haltBlocksIssuance() public {
        _issue(alice, 100e18);
        nvda.setPaused(true);
        assertEq(portfolio.haltedConstituent(), address(nvda), "reported");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.ConstituentHalted.selector, address(nvda)));
        portfolio.issue(1e18, _maxes(), alice);
    }

    function test_haltBlocksRedemption() public {
        _issue(alice, 100e18);
        nvda.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.ConstituentHalted.selector, address(nvda)));
        portfolio.redeem(1e18, _zeros(), alice);
    }

    function test_unhaltRestoresEverything() public {
        _issue(alice, 100e18);
        nvda.setPaused(true);
        nvda.setPaused(false);
        assertEq(portfolio.haltedConstituent(), address(0), "clear");
        vm.prank(alice);
        portfolio.redeem(1e18, _zeros(), alice);
    }

    /// @dev A token with no `paused()` at all must read as never halted, which is what every
    /// memecoin and bridged major on the chain is.
    function test_tokensWithoutPausedAreNeverHalted() public view {
        assertEq(portfolio.haltedConstituent(), address(0));
    }
}

contract PortfolioRebalanceTest is PortfolioFixture {
    function _targets() internal pure returns (uint256[] memory t) {
        // Rotate out of the equity leg and into the major: the cross-class case.
        t = new uint256[](3);
        t[0] = 0.25e18;
        t[1] = 0.50e18;
        t[2] = 100e18;
    }

    function _open() internal {
        _issue(alice, 100e18);
        vm.warp(block.timestamp + 30 days);
        vm.prank(creator);
        portfolio.proposeRebalance(_targets());
        vm.warp(block.timestamp + 1 days);
    }

    function test_onlyCreatorProposes() public {
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.OnlyCreator.selector, alice, creator));
        portfolio.proposeRebalance(_targets());
    }

    function test_cannotProposeBeforeSchedule() public {
        uint64 due = portfolio.nextRebalanceAt();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.NotYetDue.selector, due));
        portfolio.proposeRebalance(_targets());
    }

    function test_cannotFillDuringTimelock() public {
        _issue(alice, 100e18);
        vm.warp(block.timestamp + 30 days);
        vm.prank(creator);
        portfolio.proposeRebalance(_targets());

        vm.prank(filler);
        vm.expectRevert();
        portfolio.fillRebalance(10_000, _maxes(), _zeros());
    }

    function test_payoutWalksFromStartToEnd() public {
        _open();
        assertEq(portfolio.currentPayoutBps(), 9_700, "opens at the vault's price");
        vm.warp(block.timestamp + 3 hours);
        assertEq(portfolio.currentPayoutBps(), 9_850, "half way");
        vm.warp(block.timestamp + 3 hours);
        assertEq(portfolio.currentPayoutBps(), 10_000, "ends at par");
    }

    function test_fullFillReachesTargetUnits() public {
        _open();
        vm.warp(block.timestamp + 6 hours); // par, so the fill is exact

        vm.prank(filler);
        portfolio.fillRebalance(10_000, _maxes(), _zeros());

        uint256[] memory units = portfolio.unitsPerShare();
        uint256[] memory want = _targets();
        assertApproxEqAbs(units[0], want[0], 1, "nvda at target");
        assertApproxEqAbs(units[1], want[1], 1, "weth at target");
        assertApproxEqAbs(units[2], want[2], 1, "meme unchanged");
    }

    /// @dev The vault must never pay out more of the leg it is long than the delta itself, whatever
    /// the auction clock says. `endPayoutBps` is the ceiling and it is capped at construction.
    function test_vaultNeverPaysAboveDelta() public {
        _open();
        uint256 heldBefore = nvda.balanceOf(address(portfolio));
        uint256 supply = portfolio.totalSupply();
        uint256 target = Math.mulDiv(_targets()[0], supply, 1e18);
        uint256 delta = heldBefore - target;

        vm.warp(block.timestamp + 6 hours);
        (, uint256[] memory receive_,) = portfolio.quoteFill(10_000);
        assertLe(receive_[0], delta, "payout cannot exceed the delta at par");
    }

    function test_earlyFillLeavesThePremiumWithTheVault() public {
        _open(); // t = opensAt, payout 9700
        uint256 supply = portfolio.totalSupply();
        uint256 target = Math.mulDiv(_targets()[0], supply, 1e18);

        vm.prank(filler);
        portfolio.fillRebalance(10_000, _maxes(), _zeros());

        // The filler took only 97% of the long leg, so the vault keeps 3% of it above target.
        assertGt(nvda.balanceOf(address(portfolio)), target, "premium retained");
    }

    function test_partialFillsConverge() public {
        _open();
        vm.warp(block.timestamp + 6 hours);

        vm.startPrank(filler);
        portfolio.fillRebalance(5_000, _maxes(), _zeros());
        uint256 afterHalf = nvda.balanceOf(address(portfolio));
        portfolio.fillRebalance(10_000, _maxes(), _zeros());
        vm.stopPrank();

        uint256 supply = portfolio.totalSupply();
        uint256 target = Math.mulDiv(_targets()[0], supply, 1e18);
        assertLt(nvda.balanceOf(address(portfolio)), afterHalf, "second fill moved further");
        assertApproxEqAbs(nvda.balanceOf(address(portfolio)), target, 2, "converged to target");
    }

    /// @dev Issuance stays open during an auction, and because the delta is recomputed from live
    /// balances rather than snapshotted, the fill after it is still correct.
    function test_issuanceDuringAuctionKeepsTheFillCorrect() public {
        _open();
        _issue(filler, 100e18);
        vm.warp(block.timestamp + 6 hours);

        vm.prank(filler);
        portfolio.fillRebalance(10_000, _maxes(), _zeros());

        uint256[] memory units = portfolio.unitsPerShare();
        assertApproxEqAbs(units[0], _targets()[0], 1, "still lands on target");
    }

    function test_haltBlocksFills() public {
        _open();
        nvda.setPaused(true);
        vm.prank(filler);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.ConstituentHalted.selector, address(nvda)));
        portfolio.fillRebalance(10_000, _maxes(), _zeros());
    }

    function test_cannotFillAfterExpiry() public {
        _open();
        vm.warp(block.timestamp + 7 hours);
        vm.prank(filler);
        vm.expectRevert();
        portfolio.fillRebalance(10_000, _maxes(), _zeros());
    }

    function test_creatorCanCancelDuringTimelock() public {
        _issue(alice, 100e18);
        vm.warp(block.timestamp + 30 days);
        vm.startPrank(creator);
        portfolio.proposeRebalance(_targets());
        portfolio.cancelRebalance();
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(Portfolio.RebalanceInactive.selector);
        portfolio.currentPayoutBps();
    }

    /// @dev However the auction is filled, at whatever point on the clock, the vault must end up
    /// holding at least the target of the leg it was long. It may hold more (the unspent premium),
    /// never less.
    function testFuzz_fillNeverUndershootsTarget(uint256 elapsed, uint256 fillBps) public {
        elapsed = bound(elapsed, 0, 6 hours);
        fillBps = bound(fillBps, 1, 10_000);
        _open();
        vm.warp(block.timestamp + elapsed);

        uint256 supply = portfolio.totalSupply();
        uint256 target = Math.mulDiv(_targets()[0], supply, 1e18);

        vm.prank(filler);
        portfolio.fillRebalance(fillBps, _maxes(), _zeros());

        assertGe(nvda.balanceOf(address(portfolio)) + 2, target, "never below target");
    }
}

contract RegistryLineageTest is PortfolioFixture {
    function test_publishRejectsAnUnknownAttester() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 h = keccak256("rogue");
        bytes memory sig = _sign(h, 0, alice, deadline, 0xBADBEEF);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PortfolioRegistry.NotAnAttester.selector, vm.addr(0xBADBEEF)));
        registry.publish(h, "ipfs://x", 0, deadline, sig);
    }

    function test_manifestIsImmutableAndUnique() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 h = keccak256("manifest-v1");
        bytes memory sig = _sign(h, 0, alice, deadline, attesterKey);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PortfolioRegistry.DuplicateManifest.selector, h, manifestId)
        );
        registry.publish(h, "ipfs://again", 0, deadline, sig);
    }

    function test_refinementMintsANewVersionWithLineage() public {
        uint256 childId = _publish(keccak256("manifest-v2"), manifestId, alice);
        PortfolioRegistry.Manifest memory child = registry.manifest(childId);

        assertEq(child.parent, manifestId, "parent pointer");
        assertEq(child.depth, 1, "depth");
        assertEq(registry.children(manifestId)[0], childId, "discoverable downward");
        // The original is untouched: holders keep exactly what they bought.
        assertEq(registry.manifest(manifestId).manifestHash, keccak256("manifest-v1"));
    }

    function test_feeSplitPaysTheParent() public {
        uint256 childId = _publish(keccak256("child"), manifestId, alice);
        (address[] memory recipients, uint256[] memory bps) = registry.feeSplit(childId);

        assertEq(recipients[0], alice, "own creator first");
        assertEq(recipients[1], creator, "parent's creator");
        assertEq(bps[1], 1_000, "half the 2000bps lineage budget");
        assertEq(bps[0], 9_000, "the rest stays home");
    }

    /// @dev The invariant that makes lineage fees safe: whatever the tree looks like, the shares sum
    /// to exactly 10_000, so what is routed up can never exceed what was collected.
    function testFuzz_feeSplitAlwaysSumsToWhole(uint8 depth) public {
        depth = uint8(bound(depth, 0, registry.MAX_LINEAGE_DEPTH() * 4));
        uint256 parent = manifestId;
        for (uint256 i; i < depth; ++i) {
            parent = _publish(keccak256(abi.encode("chain", i)), parent, address(uint160(0x1000 + i)));
        }

        (address[] memory recipients, uint256[] memory bps) = registry.feeSplit(parent);
        uint256 sum;
        for (uint256 i; i < bps.length; ++i) {
            sum += bps[i];
        }
        assertEq(sum, 10_000, "shares must sum to the whole fee");
        assertLe(recipients.length, registry.MAX_LINEAGE_DEPTH() + 1, "walk is bounded");
    }

    /// @dev Sybil resistance, stated as a test: forking your own portfolio to add depth cannot
    /// increase what the tree pays out, because the lineage budget is fixed.
    function test_selfForkingCannotIncreaseTheLineagePayout() public {
        uint256 shallow = _publish(keccak256("s1"), manifestId, alice);
        (, uint256[] memory shallowBps) = registry.feeSplit(shallow);
        uint256 shallowLineage = 10_000 - shallowBps[0];

        uint256 deep = shallow;
        for (uint256 i; i < 6; ++i) {
            deep = _publish(keccak256(abi.encode("self", i)), deep, alice);
        }
        (, uint256[] memory deepBps) = registry.feeSplit(deep);
        uint256 deepLineage = 10_000 - deepBps[0];

        assertLe(deepLineage, registry.LINEAGE_BUDGET_BPS(), "never exceeds the budget");
        assertGe(deepLineage, shallowLineage, "depth only ever splits the same slice");
    }
}

contract PortfolioFeeTest is PortfolioFixture {
    function test_feeAccruesAsSharesAndDilutesUnits() public {
        _issue(alice, 100e18);
        uint256[] memory before = portfolio.unitsPerShare();

        vm.warp(block.timestamp + 365 days);
        portfolio.accrueFee();

        assertApproxEqRel(portfolio.balanceOf(address(portfolio)), 1e18, 0.01e18, "1% of supply");
        uint256[] memory after_ = portfolio.unitsPerShare();
        assertLt(after_[0], before[0], "units per share diluted by the fee");
    }

    function test_feeDistributesToCreatorAndLineage() public {
        uint256 childId = _publish(keccak256("child-fee"), manifestId, alice);
        vm.prank(alice);
        address child = factory.deploy(
            Portfolio.Config({
                name: "Forked",
                symbol: "FORK",
                registry: address(registry),
                manifestId: childId,
                constituents: _constituents(),
                seedUnits: _seedUnits(),
                feeBps: 100,
                rebalanceInterval: 30 days,
                rebalanceDelay: 1 days,
                auctionDuration: 6 hours,
                startPayoutBps: 9_700,
                endPayoutBps: 10_000
            })
        );

        Portfolio fork = Portfolio(child);
        vm.startPrank(alice);
        nvda.approve(child, type(uint256).max);
        weth.approve(child, type(uint256).max);
        meme.approve(child, type(uint256).max);
        fork.issue(100e18, _maxes(), alice);
        vm.stopPrank();

        vm.warp(block.timestamp + 365 days);
        fork.distributeFees();

        assertGt(fork.balanceOf(creator), 0, "the parent's creator was paid");
        assertGt(fork.balanceOf(alice), 0, "so was this one's");
        assertEq(fork.balanceOf(address(fork)), 0, "pot fully distributed");
    }

    function test_feeIsCappedAtConstruction() public {
        uint256 id = _publish(keccak256("greedy"), 0, creator);
        Portfolio.Config memory c = Portfolio.Config({
            name: "Greedy",
            symbol: "GREED",
            registry: address(registry),
            manifestId: id,
            constituents: _constituents(),
            seedUnits: _seedUnits(),
            feeBps: 501,
            rebalanceInterval: 30 days,
            rebalanceDelay: 1 days,
            auctionDuration: 6 hours,
            startPayoutBps: 9_700,
            endPayoutBps: 10_000
        });
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.FeeTooHigh.selector, uint16(501)));
        factory.deploy(c);
    }

    function test_payoutCeilingIsEnforcedAtConstruction() public {
        uint256 id = _publish(keccak256("costly"), 0, creator);
        Portfolio.Config memory c = Portfolio.Config({
            name: "Costly",
            symbol: "COST",
            registry: address(registry),
            manifestId: id,
            constituents: _constituents(),
            seedUnits: _seedUnits(),
            feeBps: 100,
            rebalanceInterval: 30 days,
            rebalanceDelay: 1 days,
            auctionDuration: 6 hours,
            startPayoutBps: 9_700,
            endPayoutBps: 10_101
        });
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(Portfolio.PayoutOutOfRange.selector, uint16(9_700), uint16(10_101))
        );
        factory.deploy(c);
    }
}
