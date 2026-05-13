# Pump.fun First-Time GitHub Claim Announcer

> Design document for a bot that announces first-time pump.fun fee claims by GitHub users on X (Twitter).

## Overview

When a coin is deployed on pump.fun and assigned to a GitHub user as a fee recipient, that user can claim their earned fees. This bot monitors the Solana blockchain for **first-time claims per coin per GitHub user** and posts an announcement on X.

**Core principle: Never false post.** Silent misses are acceptable; false announcements are not.

---

## On-Chain Architecture

### Programs

| Program | Address | Purpose |
|---------|---------|---------|
| Pump (bonding curve) | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Token creation, buy/sell on bonding curve |
| Pump Fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | Fee sharing, social fee PDAs, claim logic |
| Pump AMM (PumpSwap) | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | Post-graduation AMM trading |

### Key Event: `socialFeePdaClaimed`

**Discriminator:** `[50, 18, 193, 65, 237, 210, 234, 236]`

Emitted by the Pump Fees program when a GitHub user claims their fee.

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `i64` | Unix timestamp of the claim |
| `userId` | `string` | GitHub user ID (numeric, max 20 chars) |
| `platform` | `u8` | Platform identifier (GitHub only supported) |
| `socialFeePda` | `pubkey` | The PDA account for this user+coin |
| `recipient` | `pubkey` | Wallet that received the funds |
| `socialClaimAuthority` | `pubkey` | Authority that signed the claim |
| `amountClaimed` | `u64` | Lamports claimed in this transaction |
| `claimableBefore` | `u64` | Claimable balance before this claim |
| `lifetimeClaimed` | `u64` | Total lamports ever claimed on this PDA |
| `recipientBalanceBefore` | `u64` | Recipient SOL balance before |
| `recipientBalanceAfter` | `u64` | Recipient SOL balance after |

### Key Account: `socialFeePda`

Derived per `(userId, platform, mint)` — each coin+user combo has its own PDA.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | GitHub user ID |
| `platform` | `u8` | Platform identifier |
| `totalClaimed` | `u64` | Lifetime total claimed on this PDA |
| `lastClaimed` | `u64` | Timestamp of last claim |

**Critical detail:** Because the PDA is scoped per-mint, `lifetimeClaimed` and `totalClaimed` are **per-coin per-user**. A user who claimed on Coin A does NOT affect the counters for Coin B.

### Related Event: `socialFeePdaCreated`

**Discriminator:** `[183, 183, 218, 147, 24, 124, 137, 169]`

Emitted when a social fee PDA is first initialized for a user+coin pair.

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `i64` | Unix timestamp |
| `userId` | `string` | GitHub user ID |
| `platform` | `u8` | Platform identifier |

---

## First-Time Claim Detection

### Primary Check

```
isFirstClaim = (lifetimeClaimed == amountClaimed) && (amountClaimed > 0)
```

**Why this works:**
- `lifetimeClaimed` accumulates across all claims on a specific PDA (per coin, per user)
- On a first claim, lifetime equals this single claim amount
- On second+ claims, lifetime > this claim amount
- The `> 0` check prevents zero-amount fake claims from triggering

### Missed Claim Scenario

| Time | Event | Bot Status | Result |
|------|-------|------------|--------|
| t=0 | First claim (1.5 SOL) | Offline | Missed |
| t=5 | Bot restarts | Online | Listening |
| t=10 | Second claim (1.5 SOL) | Online | `lifetimeClaimed=3.0, amountClaimed=1.5` → 3.0 ≠ 1.5 → correctly skipped |

**Outcome:** Bot never false posts. It silently misses the first claim. This is the correct failure mode.

### Optional: Startup Backfill

On bot startup, scan recent transactions on the fee program for `socialFeePdaClaimed` events in the last N minutes. Any with `lifetimeClaimed == amountClaimed` are first claims that may have been missed during downtime.

---

## Attack Vectors & Defenses

### 1. Zero/Dust Claims

**Attack:** Call `claimSocialFeePda` with zero or negligible fees to trigger the event.
**Risk:** `0 == 0` → true, or dust amounts trick the check.
**Defense:** Minimum claim threshold (e.g., 0.01 SOL / 10,000,000 lamports).

### 2. Spam Token Deploys

**Attack:** Deploy worthless tokens, assign self as GitHub recipient, claim dust on each to get free promotion.
**Risk:** Each token is a separate PDA, so each is a "first claim."
**Defense:** Validate token has real trading volume and/or market cap above a threshold before posting.

### 3. Impersonation

**Attack:** Set up a social fee PDA with a `userId` mimicking a known developer.
**Risk:** `userId` is a GitHub numeric ID string — attacker would need the actual ID.
**Defense:** Resolve GitHub user profile via API, verify account age and legitimacy.

### 4. Repeated Deploy-and-Claim

**Attack:** Same person deploys many tokens, claims on each. All are technically "first claims."
**Defense:** Rate-limit announcements per `userId` (e.g., max N per day per GitHub user).

### Safe Filter Chain

```
1. amountClaimed > 0.01 SOL            → kills zero/dust claims
2. lifetimeClaimed == amountClaimed     → confirms first claim on this coin
3. Token has real trading volume/mcap   → kills self-deployed junk tokens
4. Rate limit per userId per day        → kills spam deploy attacks
```

All four checks must pass before posting.

---

## Platform Constraints

### Pump.fun Rules
- Only `Platform.GitHub` is supported for social fee recipients
- GitHub organizations are NOT supported (individual users only)
- Fee sharing config is set once and cannot be changed
- Users can only claim through pump.fun web or mobile app

### X API (Free Tier)
- 1,500 posts/month (~50/day)
- No read endpoints (post-only)
- First-time claims should be low volume — well within limits
- Each post must have unique content (not a template)

---

## Architecture

```
Solana RPC (WebSocket)
  │
  ├─ Subscribe to fee program logs
  │  Program: pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
  │
  ├─ Parse socialFeePdaClaimed events
  │  Discriminator: [50, 18, 193, 65, 237, 210, 234, 236]
  │
  ├─ Filter chain:
  │  ├─ amountClaimed > MIN_THRESHOLD
  │  ├─ lifetimeClaimed == amountClaimed
  │  ├─ Token volume/mcap check (via DexScreener or on-chain)
  │  └─ Per-user rate limit
  │
  ├─ Enrich:
  │  ├─ GitHub API → user profile (username, avatar, repos, followers)
  │  └─ Token metadata (name, symbol, CA)
  │
  └─ Post to X API (free tier)
```

### Tech Stack

- **Runtime:** Node.js / TypeScript
- **Solana:** `@solana/web3.js` for WebSocket subscription
- **Event parsing:** Anchor IDL from `pump-fun/pump-public-docs`
- **GitHub API:** REST v3 (unauthenticated for public profiles, or with token for higher rate limits)
- **X API:** v2 free tier, `POST /2/tweets`
- **Persistence:** JSON file for rate-limit state and posted-claims log (no database)

### Example Post

```
🎉 First pump.fun fee claim!

GitHub user @username just claimed their first creator fee on $TOKEN

💰 Claimed: 2.5 SOL
👨‍💻 github.com/username
🪙 Token: $TOKEN (CA: abc...xyz)

Welcome to the creator economy 🏆
```

---

## IDL Source

All type definitions and event discriminators are published at:
`https://github.com/pump-fun/pump-public-docs`

Key files:
- `idl/pump.ts` — Bonding curve program types
- `idl/pump_fees.ts` — Fee program types (socialFeePda, claims, sharing configs)
- `idl/pump_amm.ts` — AMM program types
- `docs/PUMP_PROGRAM_README.md` — Program documentation
- `docs/FEE_PROGRAM_README.md` — Fee calculation logic

---

## Implementation Checklist

- [ ] Set up Solana WebSocket subscription to fee program
- [ ] Parse `socialFeePdaClaimed` events using Anchor discriminator
- [ ] Implement 4-layer filter chain
- [ ] GitHub API integration for user profile enrichment
- [ ] X API v2 posting integration
- [ ] Rate-limit state persistence (JSON file)
- [ ] Startup backfill for missed events (optional)
- [ ] Logging and error handling
- [ ] Dry-run mode for testing without posting


