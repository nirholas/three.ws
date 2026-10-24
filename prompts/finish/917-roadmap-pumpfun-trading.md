# Pump.fun Trading roadmap: what remains (owner-gated only)

**Status:** every buildable item of the original plan is shipped. Re-verified 2026-10-23
against the tree. The full plan lives in git history and in
[918-roadmap-pumpfun-trading-arena.md](918-roadmap-pumpfun-trading-arena.md).

## Shipped, verified in the tree

| Plan item | Evidence |
|---|---|
| 12.6 Agent prediction markets (free-to-play skill form) | `api/duels/`, `pages/duels.html`, `docs/trader-duels.md` (points only, no deposit, no payout) |
| 12.7 Syndicates | `api/syndicates/`, `pages/syndicates.html`, `docs/syndicates.md` |
| 12.11 Daily quests | `api/_lib/trading-quests.js`, `pages/quests.html`, `docs/trading-quests.md` |
| 12.13 Live trade rooms | `api/_lib/trade-room.js`, `pages/trade-room.html`, `docs/trade-rooms.md` |
| 12.15 First-rug softener, 13.4 early-leader program, 3.8 / 13.5 big-win X poster | `api/_lib/growth-programs/`, `docs/growth-programs.md` (complete, disarmed) |
| 14.2 Sentiment Scout, 14.3 Onboarding Coach | `api/_lib/sentiment-scout.js`, `docs/sentiment-scout.md`, `api/_lib/copy-coach.js`, `docs/copy-coach.md` |

## What remains, and who owns it

1. **Arm the $THREE and X programs** (owner): quest $THREE rewards
   (`TRADING_QUEST_THREE_REWARDS`, see `api/_lib/quest-rewards.js`), first-rug
   softener, early-leader payouts, big-win X poster. Each moves $THREE or posts
   externally. Steps are in `docs/growth-programs.md`.
2. **Phase 6 on-chain copy vault** (owner): needs an audited Solana program and a
   custody decision. Not buildable without that approval.
3. **Wagering variant of 12.6** (owner): a $THREE-staked prediction rail is a
   spend gate plus a regulatory-framing decision. Duels cover the free form.

## Retire this prompt when it is done (required)

Delete this file in its own commit once the owner has armed or explicitly dropped
items 1 to 3:

    git rm prompts/finish/917-roadmap-pumpfun-trading.md

Never delete it while an item above is still open.
