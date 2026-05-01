---
name: cross-chain-bridge-guide
description: Guide to cross-chain bridges — bridge architectures, trust assumptions, security risks, major bridges comparison, and bridging best practices. Covers Stargate, Across, Hop, Wormhole, and official L2 bridges. Use when helping users move assets between chains safely.
license: MIT
metadata:
  category: defi
  difficulty: intermediate
  author: clawhub
  tags: [defi, cross-chain-bridge-guide]
---

# Cross-Chain Bridge Guide

Bridges move assets between blockchains. This guide covers how they work, which to use, and how to stay safe.

## Why Bridges Exist

Each blockchain is an isolated system. Bridges connect them:

```
Ethereum ←──Bridge──→ Arbitrum
    ↕                      ↕
  Bridge                 Bridge
    ↕                      ↕
 Base    ←──Bridge──→  Polygon
```

**Use cases**:
- Move ETH from Ethereum to Arbitrum for cheaper DeFi
- Access protocols only available on specific chains
- Consolidate assets scattered across chains

## Bridge Architectures

### Type 1: Native Bridges (Official L2 Bridges)

Used by rollup L2s to move between L1 and L2.

| Bridge | Route | Deposit Time | Withdrawal Time |
|--------|-------|-------------|-----------------|
| **Arbitrum Bridge** | ETH ↔ Arbitrum | ~10 min | **7 days** (fraud proof) |
| **Optimism Bridge** | ETH ↔ Optimism | ~10 min | **7 days** (fraud proof) |
| **Base Bridge** | ETH ↔ Base | ~10 min | **7 days** |
| **zkSync Bridge** | ETH ↔ zkSync | ~10 min | ~1 hour (ZK proof) |

**The 7-day problem**: Optimistic rollups require a 7-day challenge period for withdrawals to L1. This is why third-party bridges exist.

### Type 2: Liquidity Network Bridges

Pre-fund liquidity on both chains. Users swap locally:

```
User deposits ETH on Chain A → Receives ETH from liquidity pool on Chain B
(No actual cross-chain message needed — just liquidity matching)
```

| Bridge | Speed | Chains | Best For |
|--------|-------|--------|----------|
| **Stargate** | 1–5 min | 15+ | Stablecoins, large amounts |
| **Across** | 2–10 min | 10+ | ETH, fast transfers |
| **Hop** | 5–20 min | 5+ | ETH, stablecoins |

**Pros**: Fast, no 7-day wait
**Cons**: Limited by available liquidity, fees

### Type 3: Message-Passing Bridges

Send a message cross-chain, mint/release on destination:

| Bridge | Mechanism | Chains |
|--------|-----------|--------|
| **Wormhole** | Guardian network validates | 30+ |
| **LayerZero** | Oracle + relayer (ultralight) | 30+ |
| **Axelar** | PoS validator network | 50+ |

**Pros**: Support many chains and token types
**Cons**: Trust additional validator set, historically targeted by hackers

### Type 4: Lock-and-Mint

```
1. Lock tokens on Chain A
2. Mint wrapped tokens on Chain B
3. To return: Burn on Chain B → Unlock on Chain A
```

Used by: Wormhole (wETH), Multichain (any-token), many protocol-specific bridges

**Risk**: If bridge contract is hacked, all locked tokens are at risk.

## Bridge Comparison

| Bridge | Speed | Cost | Security | Best For |
|--------|-------|------|----------|----------|
| **Official L2 Bridge** | 10 min in / 7 days out | Gas only | Highest (L1 security) | Large amounts, no rush |
| **Stargate** | 1–5 min | ~$0.50–5 | High (LayerZero) | Stablecoins |
| **Across** | 2–10 min | ~$0.50–3 | High (UMA optimistic) | ETH, fast transfers |
| **Hop** | 5–20 min | ~$1–5 | High (AMM model) | Proven, reliable |
| **Wormhole** | 5–15 min | Variable | Medium (guardian set) | Multi-chain (Solana) |
| **Synapse** | 5–15 min | ~$1–5 | Medium | Wide chain support |

## Security History

Bridges have been the #1 target for hacks in crypto:

| Bridge | Date | Loss | What Happened |
|--------|------|------|--------------|
| Ronin (Axie) | Mar 2022 | $625M | Validator keys compromised |
| Wormhole | Feb 2022 | $325M | Smart contract bug |
| Nomad | Aug 2022 | $190M | Logic error in verification |
| Multichain | Jul 2023 | $130M | Admin key compromise |
| Harmony | Jun 2022 | $100M | Multisig key theft |

**Lesson**: Bridges are high-value targets. Use established bridges with strong security track records.

## Bridging to Arbitrum (Sperax's Home Chain)

To use Sperax (USDs, SPA staking, Farms), you need assets on Arbitrum:

### Recommended Paths

| From | Asset | Recommended Bridge | Time | Cost |
|------|-------|--------------------|------|------|
| Ethereum | ETH | Across or Stargate | 2–5 min | ~$1–3 |
| Ethereum | USDC | Stargate | 1–5 min | ~$0.50–2 |
| Ethereum | Any ERC-20 | Arbitrum Official Bridge | 10 min | Gas only |
| Base | ETH/USDC | Stargate or Across | 2–5 min | ~$0.50–2 |
| Optimism | ETH/USDC | Stargate or Across | 2–5 min | ~$0.50–2 |
| Polygon | USDC | Stargate | 1–5 min | ~$0.50 |

### Step-by-Step: Bridge ETH to Arbitrum

```
1. Go to bridge.arbitrum.io (official) or across.to (faster)
2. Connect wallet
3. Select: From Ethereum → To Arbitrum
4. Enter ETH amount
5. Review fees and estimated time
6. Approve and send transaction
7. Wait for confirmation on Arbitrum
8. Verify on Arbiscan that funds arrived
```

## Best Practices

### Safety Checklist

- [ ] **Use established bridges only** — Stargate, Across, Hop, official L2 bridges
- [ ] **Verify the URL** — bookmark bridge sites, don't click links
- [ ] **Start with a small test** — bridge $10 first before large amounts
- [ ] **Check bridge TVL** — higher TVL = more battle-tested
- [ ] **Verify on destination** — confirm tokens arrived on the destination chain
- [ ] **Understand wrapped vs native** — bridged USDC might be different from native USDC

### Common Mistakes

| Mistake | How to Avoid |
|---------|-------------|
| Bridging to wrong chain | Double-check destination chain before confirming |
| Not having gas on destination | Keep 0.001+ ETH on Arbitrum/L2 for gas |
| Using a hacked/deprecated bridge | Check if bridge is still active and maintained |
| Bridging during congestion | Check L1 gas prices if bridging via Ethereum |
| Getting wrapped tokens instead of native | Some bridges give wrapped USDC.e instead of native USDC |

### Native vs Wrapped Tokens

| Term | Meaning | Example on Arbitrum |
|------|---------|-------------------|
| **Native** | Issued directly on the chain | USDC (Circle native) |
| **Bridged/Wrapped** | Bridged version of an L1 token | USDC.e (bridged from Ethereum) |

Both are usable, but native is preferred for DeFi (better liquidity, no bridge risk).

> **Sperax accepts both**: USDs can be minted with both USDC (native) and USDC.e (bridged) on Arbitrum.

## Cost Optimization

### Tips

1. **Use L2-to-L2 bridges** when possible (skip L1 entirely)
2. **Bridge during low-gas periods** (weekends, US nighttime)
3. **Batch your bridging** — one $1000 bridge is cheaper than ten $100 bridges
4. **Compare on aggregators** — Li.Fi, Bungee, and Socket aggregate multiple bridges

### Bridge Cost Aggregators

| Aggregator | What It Does |
|------------|-------------|
| **Li.Fi** | Compares routes across bridges + DEXes |
| **Bungee** (Socket) | Multi-bridge route optimization |
| **Jumper** | Cross-chain swap + bridge in one tx |

## Agent Tips

1. **Official L2 bridges are safest** but slowest (7-day withdrawal)
2. **Stargate for stablecoins, Across for ETH** — best speed/security balance
3. **Never use unknown bridges** — bridge hacks are the largest losses in crypto
4. **Always keep gas on destination** — users forget they need ETH for gas on L2
5. **Test with small amount first** — especially on a new bridge or chain
6. **For Sperax/Arbitrum users**: Across or Stargate from Ethereum is the recommended path

## Links

- Arbitrum Bridge: https://bridge.arbitrum.io
- Stargate: https://stargate.finance
- Across: https://across.to
- Hop Protocol: https://hop.exchange
- Li.Fi (aggregator): https://li.fi
- L2 Bridge Comparison: https://l2beat.com/bridges
- Sperax (on Arbitrum): https://app.sperax.io
