# The $THREE utility season: "What $THREE does this week"

Twelve weekly editions, owned by Growth, scheduled as the `utility` rows of
[`marketing/growth/campaigns.csv`](../growth/campaigns.csv). Each edition shows one thing a holder can
do on three.ws today, where `$THREE` enters that action, and what anyone can check afterwards. This
directory holds the finished kit: verified status, copy, media, alt text, the user action, the KPI, and
a posting-day checklist per edition. Publishing stays with the owner.

`$THREE` contract address (Solana): `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`

## The editorial rule

**Show the action, not the ticker.** Every post answers the three questions from the
[operating plan](../OPERATING-PLAN.md): what can a holder do now, where does `$THREE` enter, and what
verifiable result comes out. On top of that, every post follows [the announcement voice](../../docs/announce-voice.md):

- 100 to 179 weighted characters on X (a URL counts as 23), one checkable claim, one link, real media.
- No hashtags, no emoji, no price, return, urgency, or "moon" language.
- Live and planned are stated plainly. A feature that does not work in production today is not written
  as live. When the scheduled surface failed verification, the edition uses the closest live substitute
  and says so in its pack.
- Every number is either a stable fact with its capture date or a placeholder read from a named endpoint
  on posting day.

## What verification found (2026-09-16)

Every scheduled surface was traced from `vercel.json` to its handler and exercised against
production. Seven of the twelve scheduled stories could not be run as written (six are substituted, one is narrowed to the MCP server), because the `$THREE`
spend paths are switched off or broken in production. Every hold-based utility checked out. The season
was rebuilt around what works, and each substitution is recorded in its pack.

| Finding | Evidence | Editions affected |
|---|---|---|
| The `$THREE` token payment rail refuses every quote | Signed-in `POST /api/token/quote` returns `treasury_unavailable`; `GET /api/token/config` shows `treasury_configured: false`, `rewards_configured: false` (`THREE_TREASURY_WALLET` and `THREE_REWARDS_WALLET` unset) | 03, 04, 10 (pay-per-use, marketplace, holder rewards) |
| Plan checkout cannot create an intent in any asset | Signed-in `POST /api/payments/solana/checkout` returns `503 not_configured` (`PAYMENT_RECIPIENT_SOLANA` unset) | 02 |
| Marketplace has no confirmed sale, `$THREE` skill prices are not rendered, and the gasless purchase builder uses the legacy token program for a Token-2022 mint | `/api/marketplace/analytics`: `totalSales: 0`; `api/_lib/solana/gasless-tx.js` | 03, 10 |
| Labor market escrow is offline | `/api/labor/feed`: `escrow_configured: false` (`LABOR_ESCROW_SECRET_BASE58` unset) | 04 |
| `/play` token gate is off and boutique sales cannot settle | No `PLAY_GATE_MINT` or `THREE_MINT`; `three-ws-multiplayer` has no `GAME_TOKEN_TREASURY` | 07 |
| x402 advertises `$THREE` but the self-hosted facilitator rejects Token-2022 transfers | `api/_lib/x402/self-facilitator.js` only allows the legacy token program | 08 |
| Holder deploy discount exists only in the MCP server; the browser deployer charges no fee, and `/deploy` is the model viewer | `src/deploy-onchain.js`, `vercel.json` | 06 |
| Premium Data API pass cannot quote `$THREE` and builds with the legacy token program | Signed-in `POST /api/premium/quote` returns `quote_failed` for THREE and USDC (SOL works) | not used |
| Public "burned" figures are computed, not on-chain | `/api/three-token/burns` and `/three-live` report `agents x 1000`; the token config says the platform never burns | 09 (do not cite) |

## Schedule

| Date | Edition | Surface used | Verified status | File | X length |
|---|---|---|---|---|---|
| 2026-09-18 | 01 hold-to-access tiers | `/three` | Live | [01-access-tiers.md](./01-access-tiers.md) | 174 |
| 2026-09-25 | 02 lower-cost access | `/forge` (holder free-quota multiplier) | Plan checkout not live; substitute | [02-holder-free-quota.md](./02-holder-free-quota.md) | 170 |
| 2026-10-02 | 03 marketplace settlement | `/docs/mcp` (`create_gated_embed`) | Marketplace not demonstrable; substitute | [03-gated-embed-mcp.md](./03-gated-embed-mcp.md) | 163 |
| 2026-10-09 | 04 agent labor and escrow | `/forge-max` (Bronze holder perk) | Escrow enabled but off; substitute | [04-forge-max-holder.md](./04-forge-max-holder.md) | 171 |
| 2026-10-16 | 05 token-gated 3D content | `/docs/token-gated-3d-embeds` | Live (API and MCP; no Studio control) | [05-gated-embed-create.md](./05-gated-embed-create.md) | 167 |
| 2026-10-23 | 06 holder deployment benefits | deploy MCP server fee schedule | Live in the MCP server only | [06-deploy-fee-waiver.md](./06-deploy-fee-waiver.md) | 175 |
| 2026-10-30 | 07 world access and purchases | live gated embed unlock | `/play` purchases off; substitute | [07-holder-scene-unlock.md](./07-holder-scene-unlock.md) | 165 |
| 2026-11-06 | 08 agent tools over x402 | `GET /api/three/tier` | `$THREE` over x402 not settleable; substitute | [08-tier-api-for-agents.md](./08-tier-api-for-agents.md) | 161 |
| 2026-11-13 | 09 public utility receipts | `/three-token` buyback ledger | Live (reads zero) | [09-buyback-ledger.md](./09-buyback-ledger.md) | 175 |
| 2026-11-20 | 10 creator earnings | `/three` (Game-Ready export perk) | Creator earnings not live; substitute | [10-gameready-holder.md](./10-gameready-holder.md) | 163 |
| 2026-11-27 | 11 built in public | `api/_lib/three-access.js` on GitHub | Live | [11-built-in-public.md](./11-built-in-public.md) | 172 |
| 2026-12-04 | 12 quarter recap | `/three` | Live (figures read on posting day) | [12-quarter-recap.md](./12-quarter-recap.md) | 149 |

X lengths for 09 and 12 are counted with the 2026-09-16 values filled into their placeholders.

If the production configuration is fixed before an edition's date, its pack names the check that proves
it (a real checkout, a settled sale, a settled bounty) and the owner can restore the original story.
Restoring means rewriting and re-capturing that edition; the substitute copy does not describe the
original surface.

## Files

- `NN-<slug>.md`: one pack per edition.
- `images/`: the captured media, 1600x900 (edition 12 is 1080x1350 for a vertical placement).
- `capture.mjs`: re-captures every image from the live site. Run it on posting day so the frame matches
  the figures in the post:

  ```bash
  node marketing/three-utility-season/capture.mjs --only 09
  ```

  It hides floating site chrome (getting-started stack, walking companion, language picker) and nothing
  else, and it exits non-zero when a frame cannot be captured.

## How to run a week

1. **Monday:** open the edition pack. Re-run every check in its posting-day checklist. If a
   check fails, do not post; move the edition and tell the owner which check failed.
2. **Re-read figures:** fill any `{PLACEHOLDER}` from the named endpoint within the hour before posting,
   then recount the post (`node -e` with the weighting in `scripts/post-tweet.mjs`, or
   `node scripts/post-tweet.mjs --file <file> --dry-run`, which prints the count and posts nothing).
3. **Re-capture:** `node marketing/three-utility-season/capture.mjs --only NN`, then open the image and
   confirm it is not blank, erroring, or mid-load.
4. **Publish (owner):** X post with the image and alt text, then the Telegram version. Edition 11 goes to
   GitHub Discussions first.
5. **24 hours and seven days:** record the result row with the campaign id, following
   [measurement.md](../growth/measurement.md), using the KPI source named in the pack. Unique wallets
   and repeat actions are the season's primary measure.
6. **Update `campaigns.csv`:** change the row's status only after the post is live and its URL is recorded.

## Owner actions that unblock the original schedule

These are configuration choices about where real funds are received, so they are the owner's to make.
Each is a single `gcloud run services update --update-env-vars` on the named service.

| Variable | Service | Unblocks |
|---|---|---|
| `THREE_TREASURY_WALLET`, `THREE_REWARDS_WALLET` | `three-ws-api` | `$THREE` pay-per-use (Forge High, Game-Ready), marketplace token rail, holder rewards |
| `PAYMENT_RECIPIENT_SOLANA` | `three-ws-api` | Plan checkout in USDC, SOL, and `$THREE` (edition 02 original) |
| `LABOR_ESCROW_SECRET_BASE58` | `three-ws-api` | Labor market escrow (edition 04 original) |
| `GAME_TOKEN_TREASURY` (and `PLAY_GATE_MINT` if the world should be gated) | `three-ws-multiplayer` | `/play` boutique and paid spins (edition 07 original) |

Three need code changes, not configuration: Token-2022 support in the x402 self-facilitator (edition 08),
in the marketplace gasless purchase builder and the Premium pass quote builder (editions 03 and 10), and
the deploy fee in the browser deployer at `/deploy-onchain` (edition 06).
