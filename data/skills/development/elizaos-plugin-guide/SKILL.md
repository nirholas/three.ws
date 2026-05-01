---
name: elizaos-plugin-guide
description: Guide to building ElizaOS plugins for autonomous AI agents. Covers the ElizaOS architecture, plugin lifecycle, action/evaluator/provider patterns, memory management, and integration with crypto/DeFi tools. ElizaOS is the leading framework for autonomous agents in Web3.
license: MIT
metadata:
  category: development
  difficulty: advanced
  author: nich
  tags: [development, elizaos-plugin-guide]
---

# ElizaOS Plugin Development Guide

ElizaOS is the leading framework for autonomous AI agents in Web3. This guide covers plugin development, architecture, and DeFi integration patterns.

## ElizaOS Architecture

```
ElizaOS Runtime
├── Core
│   ├── Memory Manager     # Persistent conversation memory
│   ├── Action System      # Tool execution
│   ├── Evaluator System   # Response quality evaluation
│   └── Provider System    # Context injection
├── Plugins
│   ├── @elizaos/plugin-solana    # Solana tools
│   ├── @elizaos/plugin-evm       # EVM chain tools
│   ├── @elizaos/plugin-twitter   # X/Twitter integration
│   └── Your custom plugin        # ← This guide
└── Clients
    ├── Discord
    ├── Telegram
    ├── Twitter/X
    └── Direct (REST API)
```

## Plugin Structure

```
my-eliza-plugin/
├── src/
│   ├── index.ts          # Plugin entry point
│   ├── actions/          # Actions (tools) the agent can execute
│   │   ├── swap.ts
│   │   └── portfolio.ts
│   ├── evaluators/       # Evaluate responses and context
│   │   └── riskCheck.ts
│   ├── providers/        # Inject context into prompts
│   │   └── priceData.ts
│   └── types.ts          # TypeScript types
├── package.json
└── tsconfig.json
```

## Entry Point

```typescript
import { Plugin } from '@elizaos/core';
import { swapAction } from './actions/swap';
import { portfolioAction } from './actions/portfolio';
import { riskEvaluator } from './evaluators/riskCheck';
import { priceProvider } from './providers/priceData';

export const speraxPlugin: Plugin = {
  name: 'sperax',
  description: 'Sperax DeFi tools — USDs yield, SPA staking, Farms',
  actions: [swapAction, portfolioAction],
  evaluators: [riskEvaluator],
  providers: [priceProvider],
};

export default speraxPlugin;
```

## Actions (Tools)

Actions are things the agent can do:

```typescript
import { Action, IAgentRuntime, Memory } from '@elizaos/core';

export const swapAction: Action = {
  name: 'SWAP_TOKENS',
  description: 'Swap tokens on a DEX',
  
  // Determines if this action should be triggered
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    return message.content.text.toLowerCase().includes('swap');
  },
  
  // Executes the action
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { tokenIn, tokenOut, amount } = parseSwapIntent(message.content.text);
    
    // Execute swap via DEX aggregator
    const result = await executeSwap({
      tokenIn,
      tokenOut,
      amount,
      chain: 'arbitrum',
    });
    
    return {
      text: `Swapped ${amount} ${tokenIn} for ${result.amountOut} ${tokenOut}`,
      action: 'SWAP_TOKENS',
    };
  },
  
  // Example conversations for the LLM
  examples: [
    [
      { user: 'user1', content: { text: 'Swap 100 USDC for SPA' } },
      { user: 'agent', content: { text: 'Swapping 100 USDC for SPA on Arbitrum...' } },
    ],
  ],
};
```

## Evaluators

Evaluators assess context and trigger behaviors:

```typescript
import { Evaluator, IAgentRuntime, Memory } from '@elizaos/core';

export const riskEvaluator: Evaluator = {
  name: 'RISK_CHECK',
  description: 'Evaluates DeFi actions for risk',
  
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    return message.content.action === 'SWAP_TOKENS' || 
           message.content.action === 'DEPOSIT';
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const riskScore = await calculateRisk(message.content);
    
    if (riskScore > 0.8) {
      await runtime.messageManager.createMemory({
        content: { text: '⚠️ High risk detected. Please review before confirming.' },
      });
    }
  },
};
```

## Providers

Providers inject context into the agent's prompt:

```typescript
import { Provider, IAgentRuntime } from '@elizaos/core';

export const priceProvider: Provider = {
  name: 'PRICE_DATA',
  description: 'Provides current crypto prices',
  
  get: async (runtime: IAgentRuntime) => {
    const prices = await fetchPrices(['SPA', 'ETH', 'BTC', 'USDs']);
    
    return `Current prices:\n${prices of the tokens listed}`;
  },
};
```

## Memory System

ElizaOS has a powerful memory system:

```typescript
// Store data in agent memory
await runtime.messageManager.createMemory({
  content: { text: 'User prefers SPA staking over LP farming' },
  roomId: message.roomId,
  userId: message.userId,
});

// Retrieve memories
const memories = await runtime.messageManager.getMemories({
  roomId: message.roomId,
  count: 10,
});
```

## DeFi Plugin Patterns

### Sperax Plugin Example

```typescript
export const speraxPlugin: Plugin = {
  name: 'sperax',
  actions: [
    mintUSDs,       // Mint USDs from collateral
    redeemUSDs,     // Redeem USDs for collateral
    stakeSPA,       // Stake SPA for veSPA
    farmDeposit,    // Deposit into Sperax Farms
    portfolioView,  // View Sperax portfolio
  ],
  evaluators: [
    slippageCheck,  // Check slippage before swaps
    gasCheck,       // Check gas before transactions
  ],
  providers: [
    speraxPrices,   // SPA, USDs prices
    farmAPYs,       // Current farm APY data
    veSPAStats,     // veSPA governance stats
  ],
};
```

## Links

- ElizaOS: https://elizaos.ai
- Docs: https://docs.elizaos.ai
- GitHub: https://github.com/elizaos/eliza
- Plugin: https://github.com/nirholas/elizaos-plugin
- SperaxOS: https://app.sperax.io
