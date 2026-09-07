// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Portfolio} from "../src/Portfolio.sol";
import {PortfolioRegistry} from "../src/PortfolioRegistry.sol";
import {PortfolioFactory} from "../src/PortfolioFactory.sol";
import {TestToken, PlainToken} from "./TestToken.sol";

/**
 * @notice Drives a portfolio through random sequences of every state-changing call it has.
 * @dev The handler deliberately does NOT filter its own inputs down to the happy path. It halts and
 * unhalts the equity leg, proposes rebalances, fills them at random points on the auction clock,
 * issues and redeems at random sizes, and lets time pass. Calls that revert are counted and
 * discarded, which is the point: the invariants below have to survive the interleaving, not a
 * curated script.
 */
contract PortfolioHandler is Test {
    Portfolio public portfolio;
    TestToken public nvda;
    PlainToken public weth;
    PlainToken public meme;
    address public creator;

    address[] public actors;
    uint256 public reverts;

    /// @notice The most recent targets a rebalance was actually proposed with.
    /// @dev Recorded so the invariant about drained legs can be stated as what is really true
    /// (a leg empties only when its creator published a zero target for it) rather than as
    /// something that merely happens to hold because the handler never proposed one.
    uint256[3] public lastTargets;
    bool public everProposed;

    constructor(Portfolio p, TestToken n, PlainToken w, PlainToken m, address c) {
        portfolio = p;
        nvda = n;
        weth = w;
        meme = m;
        creator = c;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xACC0 + i));
            actors.push(a);
            nvda.mint(a, 10_000_000e18);
            weth.mint(a, 10_000_000e18);
            meme.mint(a, 1_000_000_000e18);
            vm.startPrank(a);
            nvda.approve(address(p), type(uint256).max);
            weth.approve(address(p), type(uint256).max);
            meme.approve(address(p), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _maxes() internal pure returns (uint256[] memory m) {
        m = new uint256[](3);
        m[0] = type(uint256).max;
        m[1] = type(uint256).max;
        m[2] = type(uint256).max;
    }

    function issue(uint256 seed, uint256 shares) external {
        shares = bound(shares, 1e12, 10_000e18);
        vm.prank(_actor(seed));
        try portfolio.issue(shares, _maxes(), _actor(seed)) {} catch {
            reverts++;
        }
    }

    function redeem(uint256 seed, uint256 shares) external {
        address a = _actor(seed);
        uint256 bal = portfolio.balanceOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        vm.prank(a);
        try portfolio.redeem(shares, new uint256[](3), a) {} catch {
            reverts++;
        }
    }

    function proposeRebalance(uint256 a, uint256 b, uint256 c) external {
        uint256[] memory t = new uint256[](3);
        // Zero is allowed: exiting a constituent completely is a legitimate rebalance, and the
        // invariants have to survive it rather than be protected from it.
        t[0] = bound(a, 0, 2e18);
        t[1] = bound(b, 0, 2e18);
        t[2] = bound(c, 0, 500e18);
        vm.prank(creator);
        try portfolio.proposeRebalance(t) {
            lastTargets = [t[0], t[1], t[2]];
            everProposed = true;
        } catch {
            reverts++;
        }
    }

    function fill(uint256 seed, uint256 fillBps) external {
        fillBps = bound(fillBps, 1, 10_000);
        address a = _actor(seed);
        vm.prank(a);
        try portfolio.fillRebalance(fillBps, _maxes(), new uint256[](3)) {} catch {
            reverts++;
        }
    }

    function setHalt(bool halted) external {
        nvda.setPaused(halted);
    }

    function warp(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 45 days));
    }

    function distributeFees() external {
        try portfolio.distributeFees() {} catch {
            reverts++;
        }
    }

    /// @notice Clears any halt so the invariant reads are never blocked by the handler's last call.
    function unhaltForRead() external {
        nvda.setPaused(false);
    }
}

contract PortfolioInvariantTest is Test {
    PortfolioRegistry registry;
    PortfolioFactory factory;
    Portfolio portfolio;
    PortfolioHandler handler;
    TestToken nvda;
    PlainToken weth;
    PlainToken meme;

    uint256 attesterKey = 0xA11CE;
    address creator = address(0xC0FFEE);

    function setUp() public {
        address attester = vm.addr(attesterKey);
        registry = new PortfolioRegistry(address(this), attester);
        factory = new PortfolioFactory(address(registry));
        registry.setFactory(address(factory), true);

        nvda = new TestToken("NVDA", "NVDA", 18);
        weth = new PlainToken("WETH", "WETH");
        meme = new PlainToken("MEME", "MEME");

        uint256 deadline = block.timestamp + 365 days;
        bytes32 h = keccak256("inv");
        bytes32 structHash = keccak256(abi.encode(registry.ATTESTATION_TYPEHASH(), h, creator, uint256(0), deadline));
        (, string memory n_, string memory v_, uint256 cid, address vc,,) = registry.eip712Domain();
        bytes32 sep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(n_)),
                keccak256(bytes(v_)),
                cid,
                vc
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, keccak256(abi.encodePacked("\x19\x01", sep, structHash)));
        vm.prank(creator);
        uint256 id = registry.publish(h, "ipfs://inv", 0, deadline, abi.encodePacked(r, s, v));

        address[] memory cs = new address[](3);
        cs[0] = address(nvda);
        cs[1] = address(weth);
        cs[2] = address(meme);
        uint256[] memory units = new uint256[](3);
        units[0] = 0.5e18;
        units[1] = 0.25e18;
        units[2] = 100e18;

        vm.prank(creator);
        portfolio = Portfolio(
            factory.deploy(
                Portfolio.Config({
                    name: "Invariant",
                    symbol: "INV",
                    registry: address(registry),
                    manifestId: id,
                    constituents: cs,
                    seedUnits: units,
                    feeBps: 100,
                    rebalanceInterval: 30 days,
                    rebalanceDelay: 1 days,
                    auctionDuration: 6 hours,
                    startPayoutBps: 9_700,
                    endPayoutBps: 10_000
                })
            )
        );

        handler = new PortfolioHandler(portfolio, nvda, weth, meme, creator);
        targetContract(address(handler));
    }

    /// @dev The solvency invariant. Backing is derived from balances, so this says the vault holds
    /// at least what every outstanding share claims, after any interleaving of issuance, redemption,
    /// rebalance fills, halts, fee accrual and the passage of time.
    function invariant_backingAlwaysCoversOutstandingShares() public view {
        uint256 supply = portfolio.totalSupply();
        if (supply == 0) return;
        uint256[] memory units = portfolio.unitsPerShare();
        address[] memory cs = portfolio.constituents();
        for (uint256 i; i < cs.length; ++i) {
            assertGe(
                IERC20(cs[i]).balanceOf(address(portfolio)) * 1e18,
                units[i] * supply,
                "vault must hold what its shares claim"
            );
        }
    }

    /// @dev Once anybody has issued, the locked minimum can never be redeemed away, so `totalSupply`
    /// can never fall back to a dust value an attacker could round against.
    function invariant_minimumLiquidityStaysLocked() public view {
        if (portfolio.totalSupply() == 0) return;
        assertGe(
            portfolio.balanceOf(address(0xdead)), portfolio.MINIMUM_LIQUIDITY(), "locked shares are never returned"
        );
    }

    /// @dev A rebalance moves the vault toward published targets and never past them, so a leg can
    /// only reach zero when its creator published a zero target for it. Nothing else, and in
    /// particular no sequence of auction fills, can empty a position the manifest still wants held.
    function invariant_legsOnlyEmptyWhenTheirTargetIsZero() public view {
        if (portfolio.totalSupply() == 0) return;
        address[] memory cs = portfolio.constituents();
        for (uint256 i; i < cs.length; ++i) {
            if (IERC20(cs[i]).balanceOf(address(portfolio)) != 0) continue;
            assertTrue(handler.everProposed(), "a leg emptied with no rebalance ever proposed");
            assertEq(handler.lastTargets(i), 0, "a leg emptied while its published target was non-zero");
        }
    }

    /// @dev Lineage fees can never exceed the fee collected: the split always sums to the whole.
    function invariant_feeSplitSumsToWhole() public view {
        (, uint256[] memory bps) = registry.feeSplit(portfolio.manifestId());
        uint256 sum;
        for (uint256 i; i < bps.length; ++i) {
            sum += bps[i];
        }
        assertEq(sum, 10_000, "fee split must sum to the whole fee");
    }
}
