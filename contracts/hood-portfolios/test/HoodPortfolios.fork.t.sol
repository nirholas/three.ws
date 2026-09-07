// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Portfolio} from "../src/Portfolio.sol";
import {PortfolioRegistry} from "../src/PortfolioRegistry.sol";
import {PortfolioFactory} from "../src/PortfolioFactory.sol";
import {IStockToken, IAggregatorV3} from "../src/interfaces/IStockToken.sol";

/**
 * @notice The suite that runs against the real chain, real tokenized equities and real memecoins.
 * @dev Everything else in this directory proves the arithmetic. This proves the assumptions: that
 * Robinhood Chain's tokenized equities really are transferable ERC-20s that a vault can custody,
 * that they really do carry the `paused()` halt switch Robinhood Portfolios branches on, and that a
 * cross-class portfolio spanning an equity, a major and a memecoin can actually be issued and
 * redeemed on chain 4663 as deployed.
 *
 * Skipped, not failed, when no RPC is configured, so the default `forge test` stays offline and
 * hermetic. Run it with `ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test`.
 */
contract PortfolioForkTest is Test {
    // Verified live on chain 4663.
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant CASHCAT = 0x020bfC650A365f8BB26819deAAbF3E21291018b4;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    uint256 constant CHAIN_ID = 4663;

    PortfolioRegistry registry;
    PortfolioFactory factory;
    Portfolio portfolio;

    uint256 attesterKey = 0xA11CE;
    address attester;
    address creator = address(0xC0FFEE);
    address holder = address(0xA11CE0);

    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        try vm.createSelectFork(rpc) {
            forked = true;
        } catch {
            return;
        }

        attester = vm.addr(attesterKey);
        registry = new PortfolioRegistry(address(this), attester);
        factory = new PortfolioFactory(address(registry));
        registry.setFactory(address(factory), true);

        uint256 id = _publish(keccak256("fork-manifest"));
        address[] memory cs = new address[](3);
        cs[0] = NVDA;
        cs[1] = WETH;
        cs[2] = CASHCAT;
        uint256[] memory units = new uint256[](3);
        units[0] = 0.01e18;
        units[1] = 0.001e18;
        units[2] = 10e18;

        vm.prank(creator);
        portfolio = Portfolio(
            factory.deploy(
                Portfolio.Config({
                    name: "Robinhood Portfolios AI Infrastructure",
                    symbol: "FAII",
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

        deal(NVDA, holder, 1_000e18);
        deal(WETH, holder, 1_000e18);
        deal(CASHCAT, holder, 1_000_000e18);
        vm.startPrank(holder);
        IERC20(NVDA).approve(address(portfolio), type(uint256).max);
        IERC20(WETH).approve(address(portfolio), type(uint256).max);
        IERC20(CASHCAT).approve(address(portfolio), type(uint256).max);
        vm.stopPrank();
    }

    function _publish(bytes32 h) internal returns (uint256) {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 structHash = keccak256(abi.encode(registry.ATTESTATION_TYPEHASH(), h, creator, uint256(0), deadline));
        (, string memory name_, string memory version_, uint256 chainId, address verifying,,) = registry.eip712Domain();
        bytes32 sep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name_)),
                keccak256(bytes(version_)),
                chainId,
                verifying
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, keccak256(abi.encodePacked("\x19\x01", sep, structHash)));
        vm.prank(creator);
        return registry.publish(h, "ipfs://fork", 0, deadline, abi.encodePacked(r, s, v));
    }

    function test_chainIsRobinhood() public {
        vm.skip(!forked);
        assertEq(block.chainid, CHAIN_ID, "fork must be Robinhood Chain");
    }

    /// @dev The premise of the whole product: the equity leg is a plain, transferable ERC-20.
    function test_tokenizedEquityIsAnOrdinaryTransferableToken() public {
        vm.skip(!forked);
        assertEq(IERC20(NVDA).totalSupply() > 0, true, "has supply");
        assertEq(IStockToken(NVDA).paused(), false, "not halted right now");
        assertEq(IStockToken(NVDA).uiMultiplier(), 1e18, "no corporate action outstanding");
    }

    /// @dev The Chainlink feed exists and answers. It is a display and monitoring input only: no
    /// Robinhood Portfolios code path depends on it, which is what lets the same vault hold the 61 registry
    /// equities and every memecoin that have no feed at all.
    function test_equityFeedAnswers() public {
        vm.skip(!forked);
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(NVDA_FEED).latestRoundData();
        assertGt(answer, 0, "feed answers");
        assertGt(updatedAt, 0, "has a timestamp");
    }

    function test_issueAndRedeemACrossClassBasketOnChain() public {
        vm.skip(!forked);
        uint256[] memory maxes = new uint256[](3);
        maxes[0] = type(uint256).max;
        maxes[1] = type(uint256).max;
        maxes[2] = type(uint256).max;

        vm.prank(holder);
        uint256[] memory paid = portfolio.issue(100e18, maxes, holder);
        assertEq(paid[0], 1e18, "equity leg delivered");
        assertEq(paid[1], 0.1e18, "major leg delivered");
        assertEq(paid[2], 1_000e18, "meme leg delivered");
        assertEq(IERC20(NVDA).balanceOf(address(portfolio)), 1e18, "vault custodies the equity");

        uint256 before = IERC20(NVDA).balanceOf(holder);
        uint256 shares = portfolio.balanceOf(holder);
        vm.prank(holder);
        portfolio.redeem(shares, new uint256[](3), holder);
        assertGt(IERC20(NVDA).balanceOf(holder), before, "redeemed back out");
    }

    /// @dev A halt is not hypothetical: force the real token's paused flag and prove the vault
    /// refuses rather than reverting somewhere unhelpful deep in a transfer.
    function test_haltOfTheRealEquityStopsTheVault() public {
        vm.skip(!forked);
        uint256[] memory maxes = new uint256[](3);
        maxes[0] = type(uint256).max;
        maxes[1] = type(uint256).max;
        maxes[2] = type(uint256).max;
        vm.prank(holder);
        portfolio.issue(100e18, maxes, holder);

        vm.mockCall(NVDA, abi.encodeWithSignature("paused()"), abi.encode(true));
        assertEq(portfolio.haltedConstituent(), NVDA, "halt is detected");
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(Portfolio.ConstituentHalted.selector, NVDA));
        portfolio.redeem(1e18, new uint256[](3), holder);
    }
}
