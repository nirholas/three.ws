---
name: bnb-chain-toolkit-guide
description: Guide to the BNB Chain Toolkit — a modular TypeScript toolkit for building, deploying, and interacting with smart contracts on BNB Chain. Includes BEP-20 token utilities, DeFi integrations, wallet management, and cross-chain bridging. Built for BNB Chain Hackathon by the Sperax team.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, bnb-chain-toolkit-guide]
---

# BNB Chain Toolkit Guide

A modular TypeScript toolkit for building, deploying, and interacting with smart contracts on BNB Chain. Created by the Sperax team for the BNB Chain Hackathon.

## Modules

| Module | Purpose | Key Features |
|--------|---------|-------------|
| **Token** | BEP-20 operations | Deploy, transfer, approve, metadata |
| **DeFi** | Protocol integrations | PancakeSwap, Venus, Thena |
| **Wallet** | Wallet management | Create, import, sign, batch ops |
| **Bridge** | Cross-chain | BSC ↔ Ethereum, Arbitrum, etc. |
| **Contract** | Smart contract tools | Deploy, verify, interact, ABI |
| **MCP** | AI agent interface | All above as MCP tools |

## Quick Start

```bash
# Install
npm install @nirholas/bnb-chain-toolkit

# Or use with MCP
npx @nirholas/bnb-chain-toolkit mcp
```

## Token Module

### Deploy a BEP-20 Token

```typescript
import { TokenModule } from '@nirholas/bnb-chain-toolkit';

const token = new TokenModule(provider);
const result = await token.deploy({
  name: 'My Token',
  symbol: 'MTK',
  totalSupply: '1000000',
  decimals: 18
});
console.log(`Token deployed at: ${result.address}`);
```

### Token Operations

```typescript
// Get token info
const info = await token.getInfo('0x...');
// { name, symbol, decimals, totalSupply, owner }

// Transfer tokens
await token.transfer('0xRecipient', '1000', '0xTokenAddress');

// Approve spending
await token.approve('0xSpender', '1000', '0xTokenAddress');

// Check allowance
const allowance = await token.allowance('0xOwner', '0xSpender', '0xToken');
```

## DeFi Module

### PancakeSwap Integration

```typescript
import { DeFiModule } from '@nirholas/bnb-chain-toolkit';

const defi = new DeFiModule(provider);

// Get swap quote
const quote = await defi.getSwapQuote({
  tokenIn: 'BNB',
  tokenOut: 'USDT',
  amountIn: '1'
});

// Execute swap
await defi.swap({
  tokenIn: 'BNB',
  tokenOut: 'USDT',
  amountIn: '1',
  slippage: 0.5
});
```

### Venus Lending

```typescript
// Supply collateral
await defi.supply({ protocol: 'venus', token: 'USDT', amount: '1000' });

// Borrow
await defi.borrow({ protocol: 'venus', token: 'BNB', amount: '0.5' });
```

## Wallet Module

```typescript
import { WalletModule } from '@nirholas/bnb-chain-toolkit';

const wallet = new WalletModule();

// Create new wallet
const newWallet = wallet.create();

// Import from mnemonic
const imported = wallet.fromMnemonic('word1 word2 ...');

// Get BNB balance
const balance = await wallet.getBalance('0x...');

// Batch transfer
await wallet.batchTransfer([
  { to: '0xAddr1', amount: '1', token: 'BNB' },
  { to: '0xAddr2', amount: '100', token: 'USDT' }
]);
```

## Bridge Module

```typescript
import { BridgeModule } from '@nirholas/bnb-chain-toolkit';

const bridge = new BridgeModule(provider);

// Bridge BNB to Ethereum
await bridge.transfer({
  from: 'bsc',
  to: 'ethereum',
  token: 'BNB',
  amount: '1'
});

// Bridge USDT to Arbitrum
await bridge.transfer({
  from: 'bsc',
  to: 'arbitrum',
  token: 'USDT',
  amount: '1000'
});
```

## MCP Integration

The entire toolkit is available as MCP tools:

```json
{
  "mcpServers": {
    "bnb-toolkit": {
      "command": "npx",
      "args": ["@nirholas/bnb-chain-toolkit", "mcp"],
      "env": {
        "BSC_RPC_URL": "https://bsc-dataseed.binance.org",
        "PRIVATE_KEY": "your-key"
      }
    }
  }
}
```

## Sperax on BNB Chain

The toolkit includes Sperax-specific integrations:
- SPA token operations on BSC
- Plutus vault interactions (plvHEDGE, plvLOOP, plvDOLO)
- Cross-chain bridge to/from Arbitrum for USDs

## Links

- GitHub: https://github.com/nirholas/bnb-chain-toolkit
- BNB Chain: https://www.bnbchain.org
- Sperax: https://app.sperax.io
