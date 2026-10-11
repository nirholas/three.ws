// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title PairedToken
/// @notice A fixed-supply ERC-20 minted once, in full, to the launchpad.
///
/// @dev Deliberately minimal. There is no mint function, no owner, no pause,
/// no blacklist, and no upgrade path. Every one of those is a lever someone
/// could pull on holders later, and a launchpad whose tokens carry them is
/// asking buyers to trust the deployer. The supply that exists at construction
/// is the supply that will ever exist.
contract PairedToken {
	string public name;
	string public symbol;
	uint8 public constant decimals = 18;

	uint256 public immutable totalSupply;

	/// @notice The launchpad that created this token. Informational only: it
	/// holds no privileges over the token beyond the balance it was minted.
	address public immutable launchpad;

	/// @notice Off-chain descriptor (name, icon, links) for explorers and
	/// aggregators, plus the keccak of its exact bytes so a rehosted document
	/// cannot silently differ from what was committed at launch.
	string public metadataURI;
	bytes32 public immutable metadataHash;

	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(address indexed owner, address indexed spender, uint256 value);

	error InsufficientBalance();
	error InsufficientAllowance();
	error TransferToZero();

	constructor(
		string memory _name,
		string memory _symbol,
		uint256 _supply,
		string memory _metadataURI,
		bytes32 _metadataHash,
		address _mintTo
	) {
		name = _name;
		symbol = _symbol;
		totalSupply = _supply;
		metadataURI = _metadataURI;
		metadataHash = _metadataHash;
		launchpad = msg.sender;

		balanceOf[_mintTo] = _supply;
		emit Transfer(address(0), _mintTo, _supply);
	}

	function transfer(address to, uint256 value) external returns (bool) {
		_transfer(msg.sender, to, value);
		return true;
	}

	function transferFrom(address from, address to, uint256 value) external returns (bool) {
		uint256 allowed = allowance[from][msg.sender];
		// An allowance of max uint256 is treated as infinite and never
		// decremented, which is the convention wallets and routers expect.
		if (allowed != type(uint256).max) {
			if (allowed < value) revert InsufficientAllowance();
			unchecked {
				allowance[from][msg.sender] = allowed - value;
			}
		}
		_transfer(from, to, value);
		return true;
	}

	function approve(address spender, uint256 value) external returns (bool) {
		allowance[msg.sender][spender] = value;
		emit Approval(msg.sender, spender, value);
		return true;
	}

	function _transfer(address from, address to, uint256 value) private {
		if (to == address(0)) revert TransferToZero();
		uint256 balance = balanceOf[from];
		if (balance < value) revert InsufficientBalance();
		unchecked {
			balanceOf[from] = balance - value;
			balanceOf[to] += value;
		}
		emit Transfer(from, to, value);
	}
}
