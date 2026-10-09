// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Stand-in for a tokenized stock: a plain 18-decimal ERC-20.
contract MockStock {
	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	uint256 public totalSupply;
	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(address indexed owner, address indexed spender, uint256 value);

	constructor(string memory _symbol) {
		name = _symbol;
		symbol = _symbol;
	}

	function mint(address to, uint256 amount) external {
		totalSupply += amount;
		balanceOf[to] += amount;
		emit Transfer(address(0), to, amount);
	}

	function transfer(address to, uint256 value) external returns (bool) {
		balanceOf[msg.sender] -= value;
		balanceOf[to] += value;
		emit Transfer(msg.sender, to, value);
		return true;
	}

	function transferFrom(address from, address to, uint256 value) external returns (bool) {
		if (allowance[from][msg.sender] != type(uint256).max) {
			allowance[from][msg.sender] -= value;
		}
		balanceOf[from] -= value;
		balanceOf[to] += value;
		emit Transfer(from, to, value);
		return true;
	}

	function approve(address spender, uint256 value) external returns (bool) {
		allowance[msg.sender][spender] = value;
		emit Approval(msg.sender, spender, value);
		return true;
	}
}
