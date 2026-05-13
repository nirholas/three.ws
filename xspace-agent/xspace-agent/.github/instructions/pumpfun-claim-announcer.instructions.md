---
description: "**DOMAIN SKILL** — Use when working on pump.fun integration, Solana fee claim monitoring, GitHub social fee PDAs, first-time claim detection, or the X API announcer bot. Covers on-chain event parsing, attack vector defenses, and architecture."
applyTo: "**/pumpfun/**,**/pump-fun/**,**/claim*/**,**/announcer/**"
---

# Pump.fun First-Time GitHub Claim Announcer — Skill

## Quick Reference

### Programs

| Program | Address |
|---------|---------|
| Pump (bonding curve) | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| Pump Fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |
| Pump AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |

### First-Time Claim Detection

The `socialFeePdaClaimed` event (discriminator `[50, 18, 193, 65, 237, 210, 234, 236]`) on the Pump Fees program contains `amountClaimed` and `lifetimeClaimed`. Each `socialFeePda` is scoped per `(userId, platform, mint)` — counters are coin-specific.

**Detection formula:**
```typescript
const isFirstClaim = lifetimeClaimed === amountClaimed && amountClaimed > MIN_THRESHOLD;
```

### 4-Layer Anti-Fake Filter

All must pass before posting:

1. `amountClaimed > 0.01 SOL` — kills zero/dust claims
2. `lifetimeClaimed == amountClaimed` — confirms first claim on this coin
3. Token has real trading volume/market cap — kills self-deployed junk
4. Rate limit per userId per day — kills spam deploy attacks

### Missed Claim Safety

If bot goes offline and misses a first claim, the next claim will have `lifetimeClaimed > amountClaimed` and will be correctly skipped. **Never false posts.**

### Platform Rules

- Only `Platform.GitHub` supported (no orgs, individual users only)
- Fee sharing config is immutable once set
- Claims only through pump.fun web/mobile
- X API free tier: 1,500 posts/month, no read endpoints

### IDL Source

All types at: `https://github.com/pump-fun/pump-public-docs`
- `idl/pump_fees.ts` — socialFeePda, socialFeePdaClaimed, socialFeePdaCreated
- `idl/pump.ts` — Bonding curve, create/buy/sell events
- `idl/pump_amm.ts` — AMM pool events

### Full Design Doc

See `docs/pumpfun-claim-announcer.md` in this repo for complete architecture, attack vectors, event schemas, and implementation checklist.


