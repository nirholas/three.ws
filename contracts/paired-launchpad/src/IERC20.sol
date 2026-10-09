// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

interface IERC20 {
	function totalSupply() external view returns (uint256);
	function balanceOf(address account) external view returns (uint256);
	function transfer(address to, uint256 value) external returns (bool);
	function transferFrom(address from, address to, uint256 value) external returns (bool);
	function approve(address spender, uint256 value) external returns (bool);
	function allowance(address owner, address spender) external view returns (uint256);
	function decimals() external view returns (uint8);
	function symbol() external view returns (string memory);
}

/// @notice Transfer helpers that tolerate the tokens which return nothing.
/// @dev Some widely held ERC-20s predate the standard's return value and
/// revert a strict `bool` decode. Stock tokens on this chain look compliant,
/// but a launchpad that can be paired against an arbitrary quote asset should
/// not break on one that is merely old.
library SafeTransfer {
	error TransferFailed();

	function safeTransfer(IERC20 token, address to, uint256 value) internal {
		(bool ok, bytes memory data) = address(token).call(
			abi.encodeWithSelector(IERC20.transfer.selector, to, value)
		);
		if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
	}

	function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
		(bool ok, bytes memory data) = address(token).call(
			abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
		);
		if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
	}
}
