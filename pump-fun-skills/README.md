# pump-fun-skills

A collection of [Agent Skills](https://agentskills.io) that teach AI agents how to interact with the [pump.fun](https://pump.fun) platform. Each skill follows the Agent Skills format and can be loaded by any compatible AI agent to perform specific tasks using pump.fun's on-chain programs and SDKs.

## Overview

This skill library provides AI agents with the tools to interact with pump.fun's on-chain ecosystem:

- **Coin Creation** — Launch coins with optional initial buy, mayhem mode, cashback, tokenized agent support, and front-runner protection
- **Token Swaps** — Buy and sell tokens on bonding curve or graduated AMM pools with slippage protection
- **Creator Fee Management** — Inspect, collect, and distribute creator fees with configurable sharing among multiple shareholders
- **Tokenized Agent Payments** — Accept payments and verify invoices on-chain using the Pump Agent Payments SDK

## Available Skills

| Skill | Description |
| ----- | ----------- |
| [**Create Coin**](create-coin/) | Create coins on pump.fun with an initial buy. Supports mayhem mode, cashback, tokenized agents with buyback %, and front-runner protection via Jito. Uses the `@pump-fun/pump-sdk` and pump.fun API. |
| [**Swap**](swap/) | Buy and sell tokens on the bonding curve or AMM pool. Automatically detects coin state (bonding vs graduated) and builds the correct transaction. Supports slippage protection and Jito front-runner protection. |
| [**Coin Fees**](coin-fees/) | Inspect creator fee destinations and vault balances, collect fees, distribute shared fees to shareholders, and create or update sharing configs with up to 10 shareholders. |
| [**Tokenized Agent Payments**](tokenized-agents/) | Accept USDC or wrapped SOL payments and verify invoices on-chain for Pump Tokenized Agents using `@pump-fun/agent-payments-sdk`. Includes wallet integration guides for React/Next.js. |

## Repo Structure

```
pump-fun-skills/
├── README.md
├── create-coin/
│   ├── SKILL.md
│   ├── package.json
│   ├── references/
│   │   └── METADATA.md
│   └── scripts/
│       ├── lib/
│       └── *.mjs
├── swap/
│   ├── SKILL.md
│   ├── package.json
│   └── scripts/
│       ├── lib/
│       └── *.mjs
├── coin-fees/
│   ├── SKILL.md
│   ├── package.json
│   └── scripts/
│       ├── lib/
│       └── *.mjs
└── tokenized-agents/
    ├── SKILL.md
    └── references/
```

## Getting Started

**Install a skill** by prompting your AI agent with one of:

- A local path (if the repo is cloned):

  ```
  Install the skill create-coin/SKILL.md
  ```

- A remote URL:

  ```
  Install the skill https://raw.githubusercontent.com/pump-fun/pump-fun-skills/refs/heads/main/create-coin/SKILL.md
  ```

| Skill                    | Install command                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create Coin              | `Install the skill https://raw.githubusercontent.com/pump-fun/pump-fun-skills/refs/heads/main/create-coin/SKILL.md`                                |
| Swap                     | `Install the skill https://raw.githubusercontent.com/pump-fun/pump-fun-skills/refs/heads/main/swap/SKILL.md`                                       |
| Coin Fees                | `Install the skill https://raw.githubusercontent.com/pump-fun/pump-fun-skills/refs/heads/main/coin-fees/SKILL.md`                                  |
| Tokenized Agent Payments | `Install the skill https://raw.githubusercontent.com/pump-fun/pump-fun-skills/refs/heads/main/tokenized-agents/SKILL.md`                           |

Once installed, you can follow the skill's instructions or run the documented CLI scripts.

### Manual setup

1. **Point your AI agent at a skill.** Load the skill directory (e.g. `create-coin/`, `swap/`, `coin-fees/`, or `tokenized-agents/`) into your agent's context.

2. **Install dependencies.**
   - **Create coin skill:** `cd create-coin && npm install` then run scripts under `create-coin/scripts/` (see `create-coin/SKILL.md`).
   - **Swap skill:** `cd swap && npm install` then run scripts under `swap/scripts/` (see `swap/SKILL.md`).
   - **Coin fees skill:** `cd coin-fees && npm install` then run scripts under `coin-fees/scripts/` (see `coin-fees/SKILL.md`).
   - **Tokenized agents:** `npm install @pump-fun/agent-payments-sdk` in your app.

3. **Configure.** Provide Solana RPC URL and any mints or wallet addresses the skill requires.

4. **Invoke.** Ask your agent to follow the skill instructions or run the documented CLI scripts.

## Skill Structure

Each skill follows a consistent layout:

```
<skill>/
├── SKILL.md              # Main skill definition (required)
├── package.json          # Node.js dependencies
├── references/           # Additional documentation
│   └── *.md
└── scripts/              # Runnable CLI scripts
    ├── lib/              # Shared utilities (TX building, compute, args)
    └── *.mjs
```

The main `SKILL.md` provides core guidance, and the agent reads the specialized reference files and scripts only when needed for specific tasks.

## Example Prompts

Once a skill is installed, you can ask your AI agent things like:

```
"Create a coin on pump.fun with 0.5 SOL initial buy"
"Buy 0.1 SOL worth of token <coin address> on pump.fun"
"Sell all my tokens for <coin address>"
"Check my creator fee balance for <coin address>"
"Set up fee sharing for my coin with 2 shareholders"
"Verify if invoice #123 was paid on-chain"
```
