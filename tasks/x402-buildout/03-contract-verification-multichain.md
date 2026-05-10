# Task: Verify ThreeWSFactory + ThreeWSPayments on Base and Arbitrum

## Context

ThreeWSFactory and ThreeWSPayments are deployed on BSC, Base, and Arbitrum. BSC contracts are already verified. Base and Arbitrum need source verification on their respective block explorers.

## Compiler details (same for all contracts, all chains)

- Compiler: `v0.8.35+commit.47b9dedd`
- Optimizer: enabled, 200 runs
- License: MIT
- EVM version: default

## ThreeWSFactory

**Source** (`contracts/ThreeWSFactory.sol`):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ThreeWSFactory {
    event Deployed(address indexed addr, bytes32 indexed salt);

    function deploy(bytes32 salt, bytes memory initCode) external returns (address addr) {
        assembly {
            addr := create2(0, add(initCode, 32), mload(initCode), salt)
        }
        require(addr != address(0), "deploy failed");
        emit Deployed(addr, salt);
    }

    function predict(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt, initCodeHash
        )))));
    }
}
```

**No constructor arguments.**

| Chain | Address | Explorer verify URL |
|-------|---------|-------------------|
| Base | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | https://basescan.org/address/0x00000000D49195AE81759cd247cFeDD9D0B479df#code |
| Arbitrum | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | https://arbiscan.io/address/0x00000000D49195AE81759cd247cFeDD9D0B479df#code |

## ThreeWSPayments

**Source** (`contracts/ThreeWSPayments.sol`):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ThreeWSPayments {
    IERC20 public immutable USDC;
    uint256 public pricePerCall = 1_000;
    address public owner;

    event Payment(address indexed payer, uint256 amount, bytes32 indexed ref);
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

    function pay(bytes32 ref) external {
        uint256 amount = pricePerCall;
        USDC.transferFrom(msg.sender, address(this), amount);
        emit Payment(msg.sender, amount, ref);
    }

    function withdraw() external onlyOwner {
        uint256 bal = USDC.balanceOf(address(this));
        USDC.transfer(owner, bal);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        emit PriceUpdated(pricePerCall, newPrice);
        pricePerCall = newPrice;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
```

**Constructor arguments** (ABI-encoded):

Base (`_owner=0x4022de2d...`, `_usdc=0x833589fCD6...`):
```
0000000000000000000000004022de2d36c334e73c7a108805cea11c0564f4020000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913
```

Arbitrum (`_owner=0x4022de2d...`, `_usdc=0xaf88d065...`):
```
0000000000000000000000004022de2d36c334e73c7a108805cea11c0564f402000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831
```

| Chain | Address | Explorer verify URL |
|-------|---------|-------------------|
| Base | `0x00000000b43689a688e51a06fCC0e3F2E058720a` | https://basescan.org/address/0x00000000b43689a688e51a06fCC0e3F2E058720a#code |
| Arbitrum | `0x0000000DEDc7C0C21b0F41dB31CA690DDEEC09C8` | https://arbiscan.io/address/0x0000000DEDc7C0C21b0F41dB31CA690DDEEC09C8#code |

## Verification steps (for each contract on each explorer)

1. Go to the explorer verify URL above
2. Click "Verify and Publish"
3. Select: Solidity (Single file), compiler `v0.8.35+commit.47b9dedd`, MIT, optimization YES 200 runs
4. Paste source code
5. Paste constructor args (ThreeWSPayments only)
6. Submit

If bytecode mismatch occurs, try Standard JSON Input method — it handles metadata hash differences.

## After verification

Add name tags on each explorer:
- ThreeWSFactory: name=`three.ws Factory`, link=`https://three.ws`
- ThreeWSPayments: name=`three.ws Payments`, link=`https://three.ws/pay`

## Definition of done

- All 4 contracts (2 per chain × 2 chains) show green verified checkmark on their respective explorers
- Name tags added
- No security risk warnings on DappBay for these addresses
