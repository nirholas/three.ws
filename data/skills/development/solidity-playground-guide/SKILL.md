---
name: solidity-playground-guide
description: Guide to Lyra Web3 Playground — a browser-based Solidity IDE and smart contract playground. Write, compile, deploy, and interact with contracts directly in the browser. Supports Hardhat/Foundry compilation, multiple chains, and live contract testing.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, solidity-playground-guide]
---

# Lyra Web3 Playground — Solidity IDE Guide

A browser-based Solidity IDE for writing, compiling, deploying, and interacting with smart contracts. No local setup required — everything runs in the browser.

## Features

| Feature | Description |
|---------|-------------|
| **Solidity Editor** | Monaco editor with syntax highlighting |
| **Compiler** | In-browser Solc compilation |
| **Deploy** | Deploy to any EVM chain |
| **Interact** | Call contract functions from UI |
| **Templates** | Pre-built contract templates |
| **ABI Viewer** | Visual ABI explorer |
| **Gas Estimator** | Pre-deployment gas estimates |
| **Verification** | Auto-verify on block explorers |

## Quick Start

1. Open the playground in your browser
2. Write or paste Solidity code
3. Click "Compile"
4. Connect wallet
5. Click "Deploy"
6. Interact with your contract

## Supported Chains

| Chain | Testnet | Mainnet |
|-------|---------|---------|
| Ethereum | Sepolia | ✅ |
| Arbitrum | Sepolia | ✅ |
| Base | Sepolia | ✅ |
| Polygon | Amoy | ✅ |
| BSC | Testnet | ✅ |
| Optimism | Sepolia | ✅ |

## Contract Templates

### ERC-20 Token
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MyToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("My Token", "MTK") {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }
}
```

### ERC-8004 Agent
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@erc8004/contracts/AgentNFT.sol";

contract MyAgentRegistry is AgentNFT {
    function registerAgent(
        string memory name,
        string memory metadataURI
    ) external returns (uint256) {
        return _mintAgent(msg.sender, name, metadataURI);
    }
}
```

### Sperax USDs Vault
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract USDsVault {
    IERC20 public immutable usds;
    
    constructor(address _usds) {
        usds = IERC20(_usds);
    }
    
    function deposit(uint256 amount) external {
        usds.transferFrom(msg.sender, address(this), amount);
    }
    
    function withdraw(uint256 amount) external {
        usds.transfer(msg.sender, amount);
    }
}
```

## Interaction Panel

After deployment, the playground generates an interaction panel:

```
┌─────────────────────────────────────┐
│ Contract: MyToken                    │
│ Address: 0x742d...Bc9               │
│ Chain: Arbitrum One                  │
├─────────────────────────────────────┤
│ Read Functions:                      │
│   ├── name() → "My Token"          │
│   ├── symbol() → "MTK"             │
│   ├── totalSupply() → 1,000,000    │
│   └── balanceOf(address) → [input] │
├─────────────────────────────────────┤
│ Write Functions:                     │
│   ├── transfer(to, amount)          │
│   ├── approve(spender, amount)      │
│   └── mint(to, amount)             │
└─────────────────────────────────────┘
```

## Educational Mode

The playground includes an "Explain" feature:
- Hover over any Solidity keyword for a tooltip
- Click "Explain" to get an AI explanation of the contract
- Step-through debugger for understanding execution flow

## Links

- GitHub: https://github.com/nirholas/lyra-web3-playground
- Remix IDE: https://remix.ethereum.org (alternative)
- OpenZeppelin: https://docs.openzeppelin.com
- Sperax: https://app.sperax.io
