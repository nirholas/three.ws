// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IStockToken
 * @notice The two functions Robinhood Chain's tokenized equities add to a plain ERC-20.
 * @dev Verified live on chain 4663 against `NVDA` (0xd060...9eec), which is a beacon proxy whose
 * shared implementation lives at 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2. All 254 tokenized
 * equities on the chain share that implementation, so probing one characterises the class.
 *
 * `paused()` is the halt switch: while it is true, `transfer` reverts, so the token cannot be
 * issued into a portfolio, redeemed out of one, or rebalanced at any price.
 *
 * `uiMultiplier()` is 1e18-scaled and encodes corporate actions (a split changes it). Chainlink's
 * answers on this chain are ALREADY multiplier-adjusted, so it must never be applied on top of a
 * feed price. It is read here only to detect that a corporate action has landed since a portfolio
 * last recorded one, because a raw token balance means something different on either side of it.
 */
interface IStockToken {
    /// @notice True while the issuer has halted the token. `transfer` reverts throughout.
    function paused() external view returns (bool);

    /// @notice 1e18-scaled corporate-action multiplier.
    function uiMultiplier() external view returns (uint256);
}

/// @notice The subset of a Chainlink aggregator Robinhood Portfolios reads.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
