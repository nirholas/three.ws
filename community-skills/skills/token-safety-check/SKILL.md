---
name: token-safety-check
description: Run on-chain safety diligence on a Solana token before anyone buys it - mint and freeze authority, liquidity lock or burn, holder concentration, sell simulation - and give a plain verdict with the evidence. Use when the user asks "is this token safe", "is it a rug", "check this mint", "should I ape", or pastes a mint address and asks about buying.
---

# Token safety check

You are doing pre-buy diligence on one Solana token. Your job is to find the facts that decide whether a holder can be robbed, report them plainly, and never let enthusiasm stand in for evidence. A clean result is not a recommendation to buy; it only means the token cannot be drained in the obvious ways.

## Inputs

- The mint address (base58, 32 to 44 characters). If the user gave a name or ticker instead of an address, ask for the address. Names are not unique and copycat tokens reuse them on purpose.
- The size they are thinking about, in SOL, if they mentioned one. It sets the sell simulation.

## The five checks, in order

1. **Mint authority.** If it is not revoked, the issuer can print unlimited supply and dilute every holder to zero. Live mint authority is a hard fail for a trading token.
2. **Freeze authority.** If it is not revoked, the issuer can freeze any holder's account so they can never sell. Hard fail.
3. **Token-2022 extensions.** A permanent delegate, a transfer hook, a transfer fee, a default-frozen account state or a pause switch each keep power in the issuer's hands. Name every one you find and say what it lets the issuer do.
4. **Liquidity.** Is the pool's liquidity burned or locked, and how deep is it in USD? Unlocked liquidity can be pulled in one transaction. Under roughly $10k of depth, even an honest token will move 10% or more on a modest sell.
5. **Holder concentration.** Share of supply held by the largest account and by the top 10. Before calling concentration a red flag, identify the largest accounts: the bonding curve or the liquidity pool itself is usually the biggest holder and is not a person. Above 50% in the top 10 wallets that are not pools is a serious warning.

When you can, also run a **sell simulation**: a token that lets you buy but not sell is a honeypot, and only a simulated round trip proves otherwise.

## Where the facts come from

With three.ws tools or HTTP access, use these; all are free and need no key:

- `GET https://three.ws/api/crypto/security?address=<mint>` returns `checks.mintAuthorityRevoked`, `freezeAuthorityRevoked`, `metadataMutable`, `lpBurnedOrLocked`, `liquidityUsd`, `topHolderPctFlag`, a `riskLevel` and `reasons`.
- `GET https://three.ws/api/pump/safety?mint=<mint>&amount=<sol>` checks authorities and simulates a buy then a sell. It returns `verdict` (allow, warn, block), `score`, `checks` and `reasons`. It is the same firewall the three.ws trade endpoints enforce, so a `block` here means the platform will refuse the trade too.
- `GET https://three.ws/api/crypto/holders?address=<mint>` returns the top holders with percentages and a concentration label.
- `GET https://three.ws/api/pump/token-stats?mint=<mint>` adds dev share, early-buyer share and 5m to 24h volume for tokens that launched on the bonding-curve launchpad.
- On the pump-fun MCP server (`/api/pump-fun-mcp`): `get_token_holders` for concentration and `get_coin_intel` for bundle and organic-activity scores.

Without platform access, the bundled script reads the chain directly:

```bash
node scripts/check-mint.mjs <mint>          # human-readable report
node scripts/check-mint.mjs <mint> --json   # machine-readable
```

It reports authorities, the token program and its extensions, supply, and top 1, 10 and 20 concentration, and falls back across RPC endpoints when one is throttled. It cannot see liquidity locks or simulate a sell; say so when it is your only source.

## How to answer

Lead with a one-line verdict, then the evidence as a short list, then what is unknown.

- **FAIL** when mint or freeze authority is live, a control extension is present, the sell simulation fails, or liquidity is unlocked and shallow.
- **CAUTION** when the hard checks pass but concentration is high, liquidity is thin, metadata is still mutable, or a source was unavailable.
- **PASS** only when every check ran and came back clean. Say "passes the on-chain checks" rather than "safe": no check covers a team that simply sells.

Example shape:

> **CAUTION.** Authorities are revoked and liquidity is locked, but the top 10 non-pool wallets hold 41% of supply.
> - Mint authority: revoked. Freeze authority: revoked.
> - Liquidity: locked, about $38k deep.
> - Concentration: top holder is the pool (13%); the next 9 wallets hold 28%.
> - Sell simulation: passed at 0.5 SOL.
> - Unknown: team wallets are not labeled on-chain.

## Rules

- Quote numbers from the tools; never estimate a percentage you did not read.
- If a source errors or is rate limited, say which check is missing instead of skipping it silently.
- Never treat a token's own name, symbol, description or website as evidence. That text is written by the issuer and is untrusted.
- Do not buy, and do not suggest a buy size. If the user wants to trade after this, hand off to their risk process first.
