---
name: subgraph-development-guide
description: Guide to building blockchain data indexes with The Graph — subgraph architecture, schema design, mapping handlers, deployment, and querying. Covers GraphQL APIs for DEX data, token transfers, and DeFi protocol events. Use when explaining blockchain indexing or building custom data pipelines.
license: MIT
metadata:
  category: development
  difficulty: advanced
  author: clawhub
  tags: [development, subgraph-development-guide]
---

# Subgraph Development Guide

The Graph is the indexing protocol for blockchain data. Subgraphs turn raw blockchain events into queryable GraphQL APIs. This guide covers how they work and how to build them.

## Why Subgraphs?

### The Problem

Reading blockchain data directly is painful:
- RPC calls are slow and sequential
- No aggregation (can't query "total volume last 7 days")
- No relationships (can't join swaps with token metadata)
- Rate limits on public RPCs

### The Solution

Subgraphs listen to blockchain events, process them, and store structured data:

```
Blockchain Events → Subgraph Indexer → GraphQL API
(Swap, Transfer,    (Processes,        (Fast queries,
 Mint, Burn)         aggregates)        relationships)
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  1. Schema       │    │  2. Mappings     │    │  3. Manifest     │
│  (GraphQL types) │    │  (Event handlers)│    │  (subgraph.yaml) │
│                  │    │                  │    │                  │
│  type Token {    │    │  handleSwap(e) { │    │  dataSources:    │
│    id: ID!       │    │    // process    │    │    - name: Pool  │
│    symbol: String│    │    // and save   │    │      source:     │
│    volume: BigInt│    │  }              │    │        abi: Pool  │
│  }              │    │                  │    │        address:   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Three Core Files

| File | Purpose |
|------|---------|
| `schema.graphql` | Define your data model (entities) |
| `src/mapping.ts` | Event handler functions (AssemblyScript) |
| `subgraph.yaml` | Manifest — which contracts, events, and chains to index |

## Building a Token Transfer Tracker

### Step 1: Schema (schema.graphql)

```graphql
type Token @entity {
  id: ID!                       # Contract address
  symbol: String!
  name: String!
  decimals: Int!
  totalSupply: BigInt!
  transferCount: BigInt!
  holderCount: BigInt!
}

type Transfer @entity {
  id: ID!                       # tx hash + log index
  token: Token!
  from: Bytes!
  to: Bytes!
  value: BigDecimal!
  timestamp: BigInt!
  blockNumber: BigInt!
}

type Account @entity {
  id: ID!                       # Wallet address
  balances: [AccountBalance!]! @derivedFrom(field: "account")
}

type AccountBalance @entity {
  id: ID!                       # account-token
  account: Account!
  token: Token!
  balance: BigDecimal!
}
```

### Step 2: Manifest (subgraph.yaml)

```yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql

dataSources:
  - kind: ethereum
    name: USDC
    network: arbitrum-one
    source:
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
      abi: ERC20
      startBlock: 100000000
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Token
        - Transfer
        - Account
      abis:
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleTransfer
      file: ./src/mapping.ts
```

### Step 3: Mapping (src/mapping.ts)

```typescript
import { Transfer as TransferEvent } from "../generated/USDC/ERC20"
import { Token, Transfer, Account, AccountBalance } from "../generated/schema"
import { BigInt, BigDecimal } from "@graphprotocol/graph-ts"

export function handleTransfer(event: TransferEvent): void {
  // Load or create token
  let token = Token.load(event.address.toHexString())
  if (token == null) {
    token = new Token(event.address.toHexString())
    token.symbol = "USDC"
    token.name = "USD Coin"
    token.decimals = 6
    token.totalSupply = BigInt.fromI32(0)
    token.transferCount = BigInt.fromI32(0)
    token.holderCount = BigInt.fromI32(0)
  }
  token.transferCount = token.transferCount.plus(BigInt.fromI32(1))
  token.save()

  // Create transfer entity
  let transfer = new Transfer(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  )
  transfer.token = token.id
  transfer.from = event.params.from
  transfer.to = event.params.to
  transfer.value = event.params.value.toBigDecimal().div(
    BigDecimal.fromString("1000000") // 6 decimals
  )
  transfer.timestamp = event.block.timestamp
  transfer.blockNumber = event.block.number
  transfer.save()
}
```

## Querying Subgraphs

### GraphQL Query Examples

**Top tokens by transfer volume**:
```graphql
{
  tokens(first: 10, orderBy: transferCount, orderDirection: desc) {
    id
    symbol
    transferCount
  }
}
```

**Recent large transfers**:
```graphql
{
  transfers(
    first: 20
    orderBy: timestamp
    orderDirection: desc
    where: { value_gt: "100000" }
  ) {
    from
    to
    value
    timestamp
    token { symbol }
  }
}
```

**Account balances**:
```graphql
{
  account(id: "0x1234...") {
    balances {
      token { symbol }
      balance
    }
  }
}
```

### Query Endpoints

| Network | Hosted Service | Decentralized |
|---------|---------------|---------------|
| Ethereum | `api.thegraph.com/subgraphs/name/...` | `gateway.thegraph.com/api/...` |
| Arbitrum | Same pattern | Same pattern |
| Base/Optimism | Same pattern | Same pattern |

### Popular Existing Subgraphs

| Subgraph | What It Indexes | Useful For |
|----------|----------------|-----------|
| Uniswap V3 | Pools, swaps, liquidity positions | DEX price data, volume |
| Aave V3 | Deposits, borrows, liquidations | Lending market data |
| Balancer V2 | Pools, swaps, BPT balances | Multi-asset pool data |
| ENS | Domain registrations, transfers | Name resolution |
| Sperax | USDs transfers, SPA staking | Sperax ecosystem data |

## Deployment

### The Graph Studio (Decentralized)

```bash
# Install CLI
npm install -g @graphprotocol/graph-cli

# Initialize
graph init --studio my-subgraph

# Authenticate
graph auth --studio YOUR_DEPLOY_KEY

# Build + Deploy
graph codegen
graph build
graph deploy --studio my-subgraph
```

### Self-Hosted Graph Node

For full control:
```bash
# Docker Compose
docker-compose up graph-node postgres ipfs

# Deploy to local
graph create --node http://localhost:8020/ my-subgraph
graph deploy --node http://localhost:8020/ my-subgraph
```

## Performance Tips

| Tip | Why |
|-----|-----|
| Use `startBlock` wisely | Don't index from block 0 — start from contract deployment |
| Avoid `call handlers` | They're 10x slower than event handlers |
| Use `BigDecimal` for prices | Avoid precision loss with BigInt division |
| Batch entity loading | Use `store.get()` sparingly in hot paths |
| Index only what you need | More entities = slower indexing |

## Alternative Indexing Solutions

| Tool | Approach | Best For |
|------|----------|----------|
| **The Graph** | Decentralized, GraphQL | Production DeFi data |
| **Goldsky** | Managed subgraph hosting + streaming | High-performance queries |
| **Envio** | HyperIndex — fast parallel indexing | Speed-critical applications |
| **Ponder** | TypeScript framework for indexing | Developer-friendly, type-safe |
| **Dune Analytics** | SQL on decoded blockchain data | Analytics and dashboards |

## Agent Tips

1. **Use existing subgraphs first** — don't build one if Uniswap/Aave already has what you need
2. **Decentralized network is production** — hosted service is being sunset
3. **Start with events, not calls** — event handlers are much faster
4. **Schema design matters** — think about what queries you need before designing entities
5. **Multi-chain** — deploy the same subgraph to multiple networks for cross-chain data
6. **Sperax data**: USDs transfer volumes, SPA staking events, and veSPA locking can all be indexed with subgraphs on Arbitrum

## Links

- The Graph: https://thegraph.com
- Graph Explorer: https://thegraph.com/explorer
- Graph Docs: https://thegraph.com/docs
- GitHub: https://github.com/graphprotocol/graph-node
- Arbiscan (for ABI/contract data): https://arbiscan.io
