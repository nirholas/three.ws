// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestToken
 * @notice A faithful stand-in for a Robinhood Chain token, used only by the test suite.
 * @dev Not a mock of any Robinhood Portfolios behaviour: it is a plain ERC-20 plus the one thing the chain's
 * tokenized equities actually add, a `paused()` flag whose `true` state makes `transfer` revert.
 * That was verified against the live shared implementation every tokenized equity on chain 4663
 * proxies to, so a test that halts this token exercises the same path a real halt would.
 */
contract TestToken is ERC20 {
    bool public paused;
    uint8 private immutable _decimals;

    error EnforcedPause();

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert EnforcedPause();
        super._update(from, to, value);
    }
}

/// @notice A token with no `paused()` function at all, like the chain's memecoins and majors.
contract PlainToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
