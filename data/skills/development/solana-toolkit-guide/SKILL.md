---
name: solana-toolkit-guide
description: Guide to the Solana Wallet Toolkit — vanity address generation with multi-threaded search, official Solana Labs libraries, Rust and TypeScript implementations. Includes wallet generation, custom address prefixes, and OG names on the blockchain.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, solana-toolkit-guide]
---

# Solana Wallet Toolkit Guide

A Solana development toolkit using official Solana Labs libraries. Features vanity address generation with parallel, multi-threaded search across all CPU cores in both Rust and TypeScript.

## Features

| Feature | Description | Implementation |
|---------|-------------|---------------|
| **Vanity Addresses** | Custom wallet address prefixes | Rust (fastest) + TypeScript |
| **Multi-threaded** | Parallel search using all CPU cores | Rust + Node.js workers |
| **Wallet Generation** | Standard Solana wallet creation | TypeScript |
| **Key Management** | Keypair import/export | TypeScript |
| **MCP Server** | AI agent interface | TypeScript |

## Vanity Address Generation

### What Are Vanity Addresses?

Custom Solana addresses that start with a specific prefix:
- `SPA...` — Brand your Sperax wallet
- `DeFi...` — DeFi-themed address
- `Chad...` — Flex address

### Rust Implementation (Fastest)

```bash
# Build
cargo build --release

# Generate address starting with "SPA"
./target/release/solana-vanity --prefix SPA --threads 16
```

Performance comparison for 3-character prefix:

| Threads | Time (avg) |
|---------|-----------|
| 1 | ~45 seconds |
| 4 | ~12 seconds |
| 8 | ~6 seconds |
| 16 | ~3 seconds |

### TypeScript Implementation

```bash
# Install
npm install @nirholas/solana-wallet-toolkit

# Generate vanity address
npx solana-vanity --prefix SPA
```

```typescript
import { generateVanityAddress } from '@nirholas/solana-wallet-toolkit';

const result = await generateVanityAddress({
  prefix: 'SPA',
  threads: 8,
  caseSensitive: false
});

console.log(`Address: ${result.publicKey}`);
console.log(`Found in: ${result.attempts} attempts`);
```

## Difficulty Scaling

Solana uses Base58 encoding. Expected attempts for a prefix:

| Prefix Length | Avg Attempts | Time (8 threads) |
|--------------|-------------|------------------|
| 1 char | ~58 | < 1 second |
| 2 chars | ~3,364 | < 1 second |
| 3 chars | ~195,112 | ~3 seconds |
| 4 chars | ~11.3M | ~3 minutes |
| 5 chars | ~656M | ~3 hours |
| 6 chars | ~38B | ~7 days |

## Wallet Generation

```typescript
import { Wallet } from '@nirholas/solana-wallet-toolkit';

// Create new wallet
const wallet = Wallet.create();
console.log(wallet.publicKey.toBase58());

// From seed phrase
const restored = Wallet.fromMnemonic('your twelve words here');

// Export keypair
const keypair = wallet.exportKeypair();
```

## MCP Integration

```json
{
  "mcpServers": {
    "solana-toolkit": {
      "command": "npx",
      "args": ["@nirholas/solana-wallet-toolkit", "mcp"]
    }
  }
}
```

Tools:
- `generateWallet` — Create new Solana wallet
- `generateVanityAddress` — Generate vanity address
- `getBalance` — Check SOL/SPL token balance
- `getTokenAccounts` — List token holdings

## Use Cases

### Brand Identity
Generate a branded wallet address for your project that's recognizable and memorable.

### Security Research
Test address generation performance and entropy distribution.

### Portfolio Tracking
Use the toolkit to create and manage multiple Solana wallets for different purposes.

## Links

- GitHub: https://github.com/nirholas/solana-wallet-toolkit
- Solana Docs: https://docs.solana.com
- Sperax (multi-chain DeFi): https://app.sperax.io
