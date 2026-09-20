// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The slice of the canonical ERC-8004 IdentityRegistry this project reads.
///         Verified by eth_call against 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 on Base.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @notice The slice of the canonical ERC-8004 ReputationRegistry this project reads.
///         `getSummary` reverts with "clientAddresses required" when `clientAddresses` is
///         empty: the caller must say whose feedback it trusts. That is the standard's
///         sybil defence, not a quirk to route around.
interface IERC8004Reputation {
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}

/// @notice Routers expose the account that started the swap. The v4 Universal Router and
///         the v4-periphery routers implement this.
interface IMsgSender {
    function msgSender() external view returns (address);
}
