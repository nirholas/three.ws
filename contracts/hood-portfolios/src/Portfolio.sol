// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PortfolioRegistry} from "./PortfolioRegistry.sol";

/**
 * @title Portfolio
 * @notice A basket of tokens, held in kind, that rebalances back to published targets on a schedule.
 *
 * @dev This is deliberately the least clever contract that can do the job, because everything
 * interesting about Robinhood Portfolios happens before it: a prompt is screened against a universe of ~809
 * tokens spanning tokenized equities, majors and memes, and the result is committed to
 * `PortfolioRegistry` as an attested manifest. By the time a vault exists the decisions are made.
 * Its whole job is to hold what it was told to hold, let anyone in and out at fair value, and move
 * to the next set of targets when the schedule says so.
 *
 * Three properties do all the safety work.
 *
 * ## 1. Backing is derived, never tracked
 *
 * How much of each constituent backs one share is recomputed from this contract's own balances on
 * every call: `units_i = balance_i * 1e18 / totalSupply`. There is no stored "units" number that
 * could drift from reality, no accounting to reconcile after a donation, an airdrop or a rebasing
 * surprise, and no code path that can mint a share without the assets that back it arriving first.
 * Deliveries round UP and payouts round DOWN, so the rounding error is always the vault's gain,
 * which is why `balance_i * 1e18 >= units_i * totalSupply` holds as a consequence of the arithmetic
 * rather than as an assertion somebody has to remember to write.
 *
 * ## 2. Everything is in kind
 *
 * To mint you deliver every constituent in the ratio the vault already holds; to redeem you receive
 * every constituent pro rata. The vault never sells anything to let somebody in or out, so it eats
 * no slippage, needs no liquid market in its own share token, and needs no price oracle to operate.
 *
 * That last point is the one worth dwelling on, because Robinhood Chain has Chainlink feeds for only
 * 34 of its 95 registry equities and none at all for its memecoins. A design that priced the basket
 * on-chain to let people in and out would be unbuildable there for two thirds of the universe.
 * Pricing is a display concern, computed off-chain and shown in the UI; it is never load-bearing.
 *
 * ## 3. Rebalancing is a public offer, not a privileged trade
 *
 * There is no function on this contract that lets anyone trade the fund's assets at a price of their
 * choosing. A rebalance is proposed as a set of target units, sits behind a timelock, and then opens
 * as a descending-price offer that ANY address may fill: deliver the tokens the vault is short,
 * receive the tokens it is long. The vault starts by demanding a premium and gives that premium up
 * on a straight line as the window runs, so the first filler is whoever needs the smallest edge, and
 * the vault keeps whatever premium was left when they took it.
 *
 * Prior art, and what this is NOT: it is not Set Protocol's or Enzyme's manager-executed trade,
 * where a privileged key routes the fund's assets through a DEX and the fund wears whatever it gets.
 * It is not a keeper network, which would need one. It is closest to flock-protocol's Dutch-auction
 * rebalance, with one deliberate simplification: the auction walks a single scalar payout on the
 * whole delta basket rather than pricing each leg, so it needs no per-leg reference price and cannot
 * be filled leg-by-leg to leave the vault holding the unwanted half.
 *
 * ## Halts are a first-class state, not an edge case
 *
 * Every tokenized equity on Robinhood Chain can be paused by its issuer, and while it is, `transfer`
 * reverts. Robinhood Portfolios does not try to work around that: it cannot be worked around, because a halted
 * token cannot move at any price. Issuance, redemption and rebalancing all revert while a
 * constituent is halted, exactly as creation and redemption of a physical ETF stop when its
 * underlying stops. `haltedConstituent()` reports it plainly so the UI can say so rather than
 * showing a failed transaction.
 */
contract Portfolio is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutables ───────────────────────────────────────────────────────────

    /// @notice The registry holding this portfolio's manifest.
    PortfolioRegistry public immutable registry;

    /// @notice This portfolio's manifest id in `registry`.
    uint256 public immutable manifestId;

    /// @notice Annual management fee in basis points, charged in shares.
    uint16 public immutable feeBps;

    /// @notice Seconds between the earliest moments successive rebalances may be proposed.
    uint32 public immutable rebalanceInterval;

    /// @notice Seconds a proposed rebalance waits before it may be filled.
    uint32 public immutable rebalanceDelay;

    /// @notice Seconds a rebalance auction stays open once it starts.
    uint32 public immutable auctionDuration;

    /// @notice The payout the auction opens at, in bps of the delta basket. Below 10_000.
    uint16 public immutable startPayoutBps;

    /// @notice The payout the auction ends at, in bps. May exceed 10_000, capped by MAX_END_PAYOUT_BPS.
    uint16 public immutable endPayoutBps;

    // ── Constants ────────────────────────────────────────────────────────────

    /// @notice Hard ceiling on the annual management fee.
    uint16 public constant MAX_FEE_BPS = 500;

    /// @notice The most the vault may ever pay over the delta basket to get itself rebalanced.
    /// @dev The bound on how much a rebalance can cost holders, enforced in the constructor so it is
    /// a property of the deployed vault rather than a parameter anyone can raise later.
    uint16 public constant MAX_END_PAYOUT_BPS = 10_100;

    /// @notice Shares minted for the very first issuance, per unit of `seedUnits`.
    uint256 public constant ONE = 1e18;

    /// @notice Shares permanently locked on the first issuance.
    /// @dev The standard first-depositor defence: without it, an attacker mints 1 wei of shares,
    /// donates a large balance directly to the vault, and every subsequent issuance rounds to their
    /// benefit. Burning a fixed amount to address(0) makes `totalSupply` un-manipulably small.
    uint256 public constant MINIMUM_LIQUIDITY = 1e15;

    // ── Storage ──────────────────────────────────────────────────────────────

    address[] private _constituents;
    mapping(address => bool) public isConstituent;

    /// @notice Units of each constituent per share for the FIRST issuance only, 1e18-scaled.
    /// @dev After the first issuance, backing is derived from balances and this is never read again.
    mapping(address => uint256) public seedUnits;

    /// @notice Timestamp of the last fee accrual.
    uint64 public lastFeeAccrual;

    /// @notice Earliest timestamp at which the next rebalance may be proposed.
    uint64 public nextRebalanceAt;

    struct Rebalance {
        /// @notice Target units per share for each constituent, in `_constituents` order.
        uint256[] targetUnits;
        /// @notice When the auction opens (proposal + `rebalanceDelay`).
        uint64 opensAt;
        /// @notice When the auction stops accepting fills.
        uint64 endsAt;
        /// @notice False once cleared, so a stale proposal cannot be filled after a new one lands.
        bool active;
    }

    Rebalance private _rebalance;

    // ── Events ───────────────────────────────────────────────────────────────

    event Issued(address indexed to, uint256 shares, uint256[] amounts);
    event Redeemed(address indexed from, address indexed to, uint256 shares, uint256[] amounts);
    event FeeAccrued(uint256 shares, uint64 at);
    event FeeDistributed(address indexed recipient, uint256 shares);
    event RebalanceProposed(uint256[] targetUnits, uint64 opensAt, uint64 endsAt);
    event RebalanceCancelled();
    event RebalanceFilled(
        address indexed filler, uint256 fillBps, uint256 payoutBps, uint256[] delivered, uint256[] received
    );

    // ── Errors ───────────────────────────────────────────────────────────────

    error NoConstituents();
    error TooManyConstituents(uint256 n);
    error DuplicateConstituent(address token);
    error ZeroAddressConstituent();
    error SeedUnitRequired(address token);
    error FeeTooHigh(uint16 bps);
    error PayoutOutOfRange(uint16 startBps, uint16 endBps);
    error ZeroShares();
    error ConstituentHalted(address token);
    error NotYetDue(uint64 nextAt);
    error RebalanceInactive();
    error RebalanceNotOpen(uint64 opensAt);
    error RebalanceExpired(uint64 endsAt);
    error TargetLengthMismatch(uint256 got, uint256 want);
    error FillOutOfRange(uint256 fillBps);
    error NothingToRebalance();
    error DeliverExceedsMax(address token, uint256 required, uint256 max);
    error ReceiveBelowMin(address token, uint256 offered, uint256 min);
    error OnlyCreator(address caller, address creator);
    error BadArrayLength();

    // ── Construction ─────────────────────────────────────────────────────────

    struct Config {
        string name;
        string symbol;
        address registry;
        uint256 manifestId;
        address[] constituents;
        uint256[] seedUnits;
        uint16 feeBps;
        uint32 rebalanceInterval;
        uint32 rebalanceDelay;
        uint32 auctionDuration;
        uint16 startPayoutBps;
        uint16 endPayoutBps;
    }

    constructor(Config memory c) ERC20(c.name, c.symbol) {
        uint256 n = c.constituents.length;
        if (n == 0) revert NoConstituents();
        // Bounded so every loop in this contract has a known ceiling and issuance can never be
        // priced out of a block by a manifest with an unreasonable number of legs.
        if (n > 32) revert TooManyConstituents(n);
        if (c.seedUnits.length != n) revert BadArrayLength();
        if (c.feeBps > MAX_FEE_BPS) revert FeeTooHigh(c.feeBps);
        if (c.startPayoutBps > 10_000 || c.endPayoutBps < c.startPayoutBps || c.endPayoutBps > MAX_END_PAYOUT_BPS) {
            revert PayoutOutOfRange(c.startPayoutBps, c.endPayoutBps);
        }

        for (uint256 i; i < n; ++i) {
            address t = c.constituents[i];
            if (t == address(0)) revert ZeroAddressConstituent();
            if (isConstituent[t]) revert DuplicateConstituent(t);
            if (c.seedUnits[i] == 0) revert SeedUnitRequired(t);
            isConstituent[t] = true;
            _constituents.push(t);
            seedUnits[t] = c.seedUnits[i];
        }

        registry = PortfolioRegistry(c.registry);
        manifestId = c.manifestId;
        feeBps = c.feeBps;
        rebalanceInterval = c.rebalanceInterval;
        rebalanceDelay = c.rebalanceDelay;
        auctionDuration = c.auctionDuration;
        startPayoutBps = c.startPayoutBps;
        endPayoutBps = c.endPayoutBps;

        lastFeeAccrual = uint64(block.timestamp);
        nextRebalanceAt = uint64(block.timestamp) + c.rebalanceInterval;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function constituents() external view returns (address[] memory) {
        return _constituents;
    }

    function constituentCount() external view returns (uint256) {
        return _constituents.length;
    }

    /// @notice Units of each constituent backing one share, 1e18-scaled, in constituent order.
    /// @dev Before the first issuance this reports `seedUnits`, which is what the first issuer must
    /// deliver. After it, it is derived from balances and nothing else.
    function unitsPerShare() public view returns (uint256[] memory units) {
        uint256 n = _constituents.length;
        units = new uint256[](n);
        uint256 supply = totalSupply();
        for (uint256 i; i < n; ++i) {
            address t = _constituents[i];
            units[i] = supply == 0 ? seedUnits[t] : Math.mulDiv(IERC20(t).balanceOf(address(this)), ONE, supply);
        }
    }

    /// @notice This vault's balance of each constituent, in constituent order.
    function holdings() public view returns (uint256[] memory amounts) {
        uint256 n = _constituents.length;
        amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            amounts[i] = IERC20(_constituents[i]).balanceOf(address(this));
        }
    }

    /// @notice The first constituent that is currently halted, or address(0) if none are.
    /// @dev A token that does not implement `paused()` is treated as never halted, which is correct
    /// for the majors and memecoins in the universe: only the tokenized equities have the switch.
    function haltedConstituent() public view returns (address) {
        uint256 n = _constituents.length;
        for (uint256 i; i < n; ++i) {
            if (_isHalted(_constituents[i])) return _constituents[i];
        }
        return address(0);
    }

    function _isHalted(address token) internal view returns (bool) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("paused()"));
        return ok && data.length == 32 && abi.decode(data, (bool));
    }

    /// @notice The live rebalance proposal.
    function rebalance()
        external
        view
        returns (uint256[] memory targetUnits, uint64 opensAt, uint64 endsAt, bool active)
    {
        Rebalance storage r = _rebalance;
        return (r.targetUnits, r.opensAt, r.endsAt, r.active);
    }

    /// @notice The payout, in bps of the delta basket, a filler would receive right now.
    /// @dev Linear from `startPayoutBps` at `opensAt` to `endPayoutBps` at `endsAt`. Reverts unless
    /// an auction is actually open, so a UI reading this is never shown a price it cannot trade at.
    function currentPayoutBps() public view returns (uint256) {
        Rebalance storage r = _rebalance;
        if (!r.active) revert RebalanceInactive();
        if (block.timestamp < r.opensAt) revert RebalanceNotOpen(r.opensAt);
        if (block.timestamp > r.endsAt) revert RebalanceExpired(r.endsAt);
        uint256 span = r.endsAt - r.opensAt;
        if (span == 0) return endPayoutBps;
        uint256 elapsed = block.timestamp - r.opensAt;
        return startPayoutBps + ((uint256(endPayoutBps) - startPayoutBps) * elapsed) / span;
    }

    /**
     * @notice What a filler must deliver and would receive for `fillBps` of the open rebalance.
     * @dev Computed from live balances rather than from a snapshot taken when the auction opened.
     * That is what lets issuance and redemption stay open throughout an auction: they change the
     * vault's size, the delta scales with it, and no stored number goes stale. A filler always
     * quotes against the state their transaction will actually execute against.
     */
    function quoteFill(uint256 fillBps)
        public
        view
        returns (uint256[] memory deliver, uint256[] memory receive_, uint256 payoutBps)
    {
        if (fillBps == 0 || fillBps > 10_000) revert FillOutOfRange(fillBps);
        Rebalance storage r = _rebalance;
        if (!r.active) revert RebalanceInactive();
        payoutBps = currentPayoutBps();

        uint256 n = _constituents.length;
        deliver = new uint256[](n);
        receive_ = new uint256[](n);
        uint256 supply = totalSupply();
        if (supply == 0) revert NothingToRebalance();

        bool any;
        for (uint256 i; i < n; ++i) {
            uint256 held = IERC20(_constituents[i]).balanceOf(address(this));
            uint256 target = Math.mulDiv(r.targetUnits[i], supply, ONE);
            if (target > held) {
                // The vault is short this leg: the filler delivers it, rounded UP.
                deliver[i] = Math.mulDiv(target - held, fillBps, 10_000, Math.Rounding.Ceil);
                if (deliver[i] != 0) any = true;
            } else if (held > target) {
                // The vault is long this leg: the filler receives it, rounded DOWN, after payout.
                uint256 gross = Math.mulDiv(held - target, fillBps, 10_000);
                receive_[i] = Math.mulDiv(gross, payoutBps, 10_000);
                if (receive_[i] != 0) any = true;
            }
        }
        if (!any) revert NothingToRebalance();
    }

    // ── Issuance and redemption ──────────────────────────────────────────────

    /**
     * @notice Mint `shares` by delivering every constituent in the ratio the vault already holds.
     * @param shares How many shares to mint.
     * @param maxAmounts Per-constituent ceiling on what the caller will deliver, in constituent
     * order. A caller who is happy with any amount passes `type(uint256).max` for each.
     * @param to Who receives the shares.
     * @return amounts What was actually delivered, in constituent order.
     */
    function issue(uint256 shares, uint256[] calldata maxAmounts, address to)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (shares == 0) revert ZeroShares();
        uint256 n = _constituents.length;
        if (maxAmounts.length != n) revert BadArrayLength();
        _requireNoHalt();
        _accrueFee();

        uint256 supply = totalSupply();
        amounts = new uint256[](n);

        // The first issuance is the only one that reads `seedUnits`; every later one is priced off
        // the balances already in the vault, so an issuer can never mint at a stale ratio.
        for (uint256 i; i < n; ++i) {
            address t = _constituents[i];
            uint256 amount = supply == 0
                ? Math.mulDiv(seedUnits[t], shares, ONE, Math.Rounding.Ceil)
                : Math.mulDiv(IERC20(t).balanceOf(address(this)), shares, supply, Math.Rounding.Ceil);
            if (amount > maxAmounts[i]) revert DeliverExceedsMax(t, amount, maxAmounts[i]);
            amounts[i] = amount;
            if (amount != 0) IERC20(t).safeTransferFrom(msg.sender, address(this), amount);
        }

        if (supply == 0) {
            // Locked forever, so `totalSupply` can never be dust an attacker can round against.
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
            _mint(to, shares - MINIMUM_LIQUIDITY);
        } else {
            _mint(to, shares);
        }
        emit Issued(to, shares, amounts);
    }

    /**
     * @notice Burn `shares` and receive every constituent pro rata.
     * @param shares How many shares to burn.
     * @param minAmounts Per-constituent floor on what the caller will accept, in constituent order.
     * @param to Who receives the tokens.
     * @return amounts What was paid out, in constituent order.
     * @dev Reverts while any constituent is halted. That is not a policy choice that could have gone
     * the other way: a pro-rata payout of a halted token cannot be transferred, and paying out only
     * the legs that happen to be transferable would hand the redeemer the liquid assets and leave
     * everyone still holding shares backing the frozen one. Redemption waits, and nobody is diluted.
     */
    function redeem(uint256 shares, uint256[] calldata minAmounts, address to)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (shares == 0) revert ZeroShares();
        uint256 n = _constituents.length;
        if (minAmounts.length != n) revert BadArrayLength();
        _requireNoHalt();
        _accrueFee();

        uint256 supply = totalSupply();
        amounts = new uint256[](n);

        // Burn before paying out so the payout ratio is measured against the supply the redeemer is
        // leaving behind, and so no callback during a transfer can re-enter against unburnt shares.
        _burn(msg.sender, shares);

        for (uint256 i; i < n; ++i) {
            address t = _constituents[i];
            uint256 amount = Math.mulDiv(IERC20(t).balanceOf(address(this)), shares, supply);
            if (amount < minAmounts[i]) revert ReceiveBelowMin(t, amount, minAmounts[i]);
            amounts[i] = amount;
            if (amount != 0) IERC20(t).safeTransfer(to, amount);
        }
        emit Redeemed(msg.sender, to, shares, amounts);
    }

    // ── Rebalancing ──────────────────────────────────────────────────────────

    /**
     * @notice Propose the next set of target units per share.
     * @dev Callable only by the manifest's creator, and only once the schedule the manifest declared
     * has come due. It does not move anything: it starts a timelock, after which ANY address may
     * fill the resulting offer. The creator therefore chooses the destination and never the price,
     * and cannot touch the assets at all.
     */
    function proposeRebalance(uint256[] calldata targetUnits) external {
        PortfolioRegistry.Manifest memory m = registry.manifest(manifestId);
        if (msg.sender != m.creator) revert OnlyCreator(msg.sender, m.creator);
        if (block.timestamp < nextRebalanceAt) revert NotYetDue(nextRebalanceAt);
        uint256 n = _constituents.length;
        if (targetUnits.length != n) revert TargetLengthMismatch(targetUnits.length, n);

        uint64 opensAt = uint64(block.timestamp) + rebalanceDelay;
        uint64 endsAt = opensAt + auctionDuration;
        _rebalance = Rebalance({targetUnits: targetUnits, opensAt: opensAt, endsAt: endsAt, active: true});
        nextRebalanceAt = uint64(block.timestamp) + rebalanceInterval;

        emit RebalanceProposed(targetUnits, opensAt, endsAt);
    }

    /// @notice Withdraw a proposal before it opens. Only the creator, and only during the timelock.
    function cancelRebalance() external {
        PortfolioRegistry.Manifest memory m = registry.manifest(manifestId);
        if (msg.sender != m.creator) revert OnlyCreator(msg.sender, m.creator);
        Rebalance storage r = _rebalance;
        if (!r.active) revert RebalanceInactive();
        if (block.timestamp >= r.opensAt) revert RebalanceNotOpen(r.opensAt);
        r.active = false;
        emit RebalanceCancelled();
    }

    /**
     * @notice Fill some or all of the open rebalance: deliver what the vault is short, take what it
     * is long, at the payout the descending auction has reached.
     * @param fillBps The fraction of the outstanding delta to fill, in basis points.
     * @param maxDeliver Per-constituent ceiling on what the filler will deliver.
     * @param minReceive Per-constituent floor on what the filler will accept.
     */
    function fillRebalance(uint256 fillBps, uint256[] calldata maxDeliver, uint256[] calldata minReceive)
        external
        nonReentrant
        returns (uint256[] memory delivered, uint256[] memory received)
    {
        uint256 n = _constituents.length;
        if (maxDeliver.length != n || minReceive.length != n) revert BadArrayLength();
        _requireNoHalt();
        _accrueFee();

        uint256 payoutBps;
        (delivered, received, payoutBps) = quoteFill(fillBps);

        // Take everything in before paying anything out, so a token with a transfer callback cannot
        // re-enter to be paid twice against a balance that has not been topped up yet.
        for (uint256 i; i < n; ++i) {
            uint256 amount = delivered[i];
            if (amount == 0) continue;
            if (amount > maxDeliver[i]) revert DeliverExceedsMax(_constituents[i], amount, maxDeliver[i]);
            IERC20(_constituents[i]).safeTransferFrom(msg.sender, address(this), amount);
        }
        for (uint256 i; i < n; ++i) {
            uint256 amount = received[i];
            if (amount < minReceive[i]) revert ReceiveBelowMin(_constituents[i], amount, minReceive[i]);
            if (amount != 0) IERC20(_constituents[i]).safeTransfer(msg.sender, amount);
        }

        emit RebalanceFilled(msg.sender, fillBps, payoutBps, delivered, received);
    }

    // ── Fees ─────────────────────────────────────────────────────────────────

    /// @notice Accrue the management fee up to now. Called automatically by every state change.
    function accrueFee() external {
        _accrueFee();
    }

    /// @dev Mints the fee to this contract as shares. Minting shares without adding assets is
    /// exactly what a management fee is: it dilutes `unitsPerShare` for everyone, including the
    /// creator, in proportion to time held. Because backing is derived, nothing else has to change.
    function _accrueFee() internal {
        uint64 last = lastFeeAccrual;
        if (block.timestamp <= last) return;
        uint256 elapsed = block.timestamp - last;
        lastFeeAccrual = uint64(block.timestamp);

        uint256 supply = totalSupply();
        if (supply == 0 || feeBps == 0) return;

        uint256 shares = Math.mulDiv(supply, uint256(feeBps) * elapsed, uint256(10_000) * 365 days);
        if (shares == 0) return;
        _mint(address(this), shares);
        emit FeeAccrued(shares, uint64(block.timestamp));
    }

    /**
     * @notice Pay the accrued fee out to this portfolio's creator and its lineage.
     * @dev Permissionless: the split is read from the registry, which computed it from the lineage
     * tree, so there is nobody who can decline to publish it and nothing to claim off-chain.
     */
    function distributeFees() external nonReentrant {
        _accrueFee();
        uint256 pot = balanceOf(address(this));
        if (pot == 0) return;

        (address[] memory recipients, uint256[] memory bps) = registry.feeSplit(manifestId);
        uint256 paid;
        // Recipients after the first are ancestors; pay them their exact share and let the remainder
        // fall to `recipients[0]`, so rounding dust can never leave the pot short or over-pay.
        for (uint256 i = recipients.length; i > 1; --i) {
            uint256 amount = Math.mulDiv(pot, bps[i - 1], 10_000);
            if (amount == 0) continue;
            paid += amount;
            _transfer(address(this), recipients[i - 1], amount);
            emit FeeDistributed(recipients[i - 1], amount);
        }
        uint256 rest = pot - paid;
        if (rest != 0) {
            _transfer(address(this), recipients[0], rest);
            emit FeeDistributed(recipients[0], rest);
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _requireNoHalt() internal view {
        address halted = haltedConstituent();
        if (halted != address(0)) revert ConstituentHalted(halted);
    }
}
