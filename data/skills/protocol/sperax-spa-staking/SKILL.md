---
name: sperax-spa-staking
description: Guide to SPA token staking, veSPA governance, and xSPA rewards in the Sperax ecosystem. Covers lock mechanics, voting power, reward claiming, and governance participation. Use when explaining SPA tokenomics, helping users stake, or answering governance questions.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: clawhub
  tags: [protocol, sperax-spa-staking]
---

# SPA Staking & Governance Guide

The Sperax governance system uses a **vote-escrowed** model: lock SPA to get veSPA, which gives governance voting power and protocol fee rewards.

## Token Overview

### SPA — Governance & Value Accrual

| Property | Detail |
|----------|--------|
| Chain | Arbitrum One |
| Address | `0x5575552988A3A80504bBaeB1311674fCFd40aD4B` |
| Value accrual | 30% of USDs yield + 100% of protocol fees → buyback-and-burn |
| Also on | Ethereum: `0xB4A3B0Faf0Ab53df58001804DdA5Bfc6a3D59008` |

### veSPA — Governance Power

Lock your SPA for 7 days to 4 years to receive veSPA:

```
veSPA = SPA × (lockup_days / 365)
```

- **Minimum lock**: 7 days
- **Maximum lock**: 4 years (1,461 days)
- **Decay**: veSPA decays linearly toward your lock expiry
- **Rewards**: 100% of USDs protocol fees + 420,000 xSPA/week

**Example**: Lock 1,000 SPA for 2 years → receive 2,000 veSPA (decaying over time)

### xSPA — Reward Token

xSPA is the reward distributed to veSPA stakers weekly (Thursdays UTC).

| Option | What happens |
|--------|-------------|
| Stake xSPA → veSPA | 1:1 ratio, but requires ≥180-day lock |
| Redeem xSPA → SPA | 0.5–1.0 SPA over 15–180 days |

**Redemption formula**:
```
Receivable SPA = (xSPA × (redeemDuration + 150)) / 330
```

- Redeem over 15 days → ~0.5 SPA per xSPA
- Redeem over 180 days → 1.0 SPA per xSPA

## Staking Walkthrough

### Step 1: Get SPA on Arbitrum

Buy SPA on Arbitrum One via any DEX (Camelot, Uniswap). If you have SPA on Ethereum, bridge it to Arbitrum first.

### Step 2: Lock SPA → veSPA

1. Go to [app.sperax.io](https://app.sperax.io)
2. Navigate to the Staking section
3. Choose lock duration (longer = more veSPA)
4. Approve and lock SPA

### Step 3: Earn Rewards

- **Fees**: Distributed weekly in USDs
- **xSPA**: 420,000 xSPA distributed weekly (per SIP-66)
- **Claim**: Visit the Staking page to claim accumulated rewards

### Step 4: Manage xSPA

Choose to either:
- **Stake** into veSPA (1:1, but requires ≥180-day lock)
- **Redeem** to SPA (0.5–1.0 ratio based on vesting period)

## Governance Process

Sperax uses a 4-phase governance model:

| Phase | Activity | Duration |
|-------|----------|----------|
| Phase 0 | Discord ideation | Open-ended |
| Phase 1 | Forum SIP proposal | 48-hour discussion minimum |
| Phase 2 | Snapshot vote | 3 days, veSPA-weighted |
| Phase 3 | Engineering implementation | Varies |

**Voting**: Snapshot.org with veSPA weighting
- Quorum: 200M veSPA
- Passing: >50% Yes votes

**Snapshot**: https://snapshot.box/#/s:speraxdao.eth

## Key Contracts (Arbitrum)

| Contract | Address |
|----------|---------|
| SPA | `0x5575552988A3A80504bBaeB1311674fCFd40aD4B` |
| veSPA Proxy | `0x2e2071180682Ce6C247B1eF93d382D509F5F6A17` |
| xSPA | `0x0966E72256d6055145902F72F9D3B6a194B9cCc3` |

## Agent Tips

When helping users with SPA staking:
1. Emphasize the tradeoff: longer lock = more veSPA = more rewards, but less liquidity
2. xSPA redemption: longer redeem period = better ratio (max 1:1 at 180 days)
3. Check current APYs at [app.sperax.io](https://app.sperax.io) before recommending
4. Governance requires veSPA — you must lock SPA first

## Links

- Sperax App: https://app.sperax.io
- Sperax Docs: https://docs.chat.sperax.io
- Governance Forum: https://snapshot.box/#/s:speraxdao.eth
- SperaxOS: https://chat.sperax.io
