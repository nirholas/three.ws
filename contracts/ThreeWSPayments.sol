// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ThreeWSPayments
 * @notice x402 pay-per-call receiver for three.ws MCP tools on BNB Chain.
 *         Agents call pay() with a USDC allowance; the contract logs the
 *         on-chain receipt and the three.ws server verifies it before
 *         executing the requested tool.
 *
 *         Deployed to a CREATE2 vanity address starting with 0x333...
 *         Factory: 0x4e59b44847b379578588920cA78FbF26c0B4956C (Arachnid)
 *         Website: https://three.ws/pay
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ThreeWSPayments {
    IERC20 public immutable USDC;

    // $0.001 USDC per tool call (6 decimals)
    uint256 public pricePerCall = 1_000;

    address public owner;

    event Payment(
        address indexed payer,
        uint256 amount,
        bytes32 indexed ref   // keccak256 of the JSON-RPC request body
    );
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _usdc) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_usdc == address(0)) revert ZeroAddress();
        owner = _owner;
        USDC = IERC20(_usdc);
    }

    /// @notice Pay for one tool call. Caller must have approved `pricePerCall` USDC.
    /// @param ref  keccak256 of the request body — lets the server match payment to call.
    function pay(bytes32 ref) external {
        uint256 amount = pricePerCall;
        USDC.transferFrom(msg.sender, address(this), amount);
        emit Payment(msg.sender, amount, ref);
    }

    /// @notice Withdraw accumulated USDC to owner.
    function withdraw() external onlyOwner {
        uint256 bal = USDC.balanceOf(address(this));
        USDC.transfer(owner, bal);
    }

    /// @notice Update per-call price.
    function setPrice(uint256 newPrice) external onlyOwner {
        emit PriceUpdated(pricePerCall, newPrice);
        pricePerCall = newPrice;
    }

    /// @notice Transfer ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
