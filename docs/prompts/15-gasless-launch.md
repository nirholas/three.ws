# 15. Gasless token launch, a second Solana launch venue, and `npx three-ws launch`

Read `docs/prompts/README.md` first.

## The problem

Token launch is real and two-phase (`api/pump/[action].js`: `build-metadata`, `launch-prep`, `launch-confirm`, `launch-agent`; the studio in `api/pump/launch-studio.js`; creator-fee sharing and claiming in `api/agents/pumpfun/[action].js`, `api/_lib/pump-claims.js` and the claimer cron). Two gaps: there is no gasless launch path (the relayer patterns in `api/marketplace/purchase.js`, `api/subscriptions/subscribe.js` and `api/_lib/solana-signers.js` cover purchases and registration only), so a fresh wallet with no SOL cannot launch; and there is no one-command launch from a terminal. A second Solana launch venue would also let creators choose bonding-curve versus fixed-supply launches.

## Build

### Gasless launch

`launch-prep` gains `gasless: true`: the platform fee-payer signs for rent and network fees, recovered from the creator-fee share the platform already collects, capped per account per day in `app_settings`, with the anomaly guards applied. The launch confirm returns the signature and the mint. Expose it as `launch_token_gasless` (financial, `confirm_launch`, fresh `prep_id`) alongside the existing tools, and as a toggle in the launch studio with the fee explanation visible before confirm.

### Second venue

Add a fixed-supply launch on a Solana token-launch program that is not a bonding curve (a maintained program with a public SDK; pick by that criterion and record it; no venue token names in committed code): `launch-genesis-prep` and `launch-genesis-confirm` in `api/native-launch/[action].js` or a sibling, tool `launch_fixed_supply_token` (financial, `confirm_launch`), the same creator-fee accounting where the venue supports it, and the same `pump_agent_mints` style record so `/launches` and agent profiles list both kinds with a venue badge. `get_launch_status` reports eligibility for each venue and why (balance, metadata, rate limits).

### Creator economics, visible

The launch studio and the launch detail page state the creator's fee share as a number pulled from the same setting the claimer uses, the platform share, and the portion routed to the `$THREE` buyback by `api/cron/economy-tick.js`, with a live link to the buyback ledger. If the share is not one setting today, make it one.

### `npx three-ws launch`

In the CLI from prompt 01: `three-ws launch --name --symbol --description --image <path or url> [--agent <id>] [--gasless] [--venue curve|fixed]` runs metadata upload, prep, prints the confirmation table (recipient, amount, token, chain, venue, fees) and waits for an explicit `yes`, then confirms and prints the mint, signature and the live page. `--dry-run` stops after the table. Interactive mode prompts for anything missing and previews the image.

## Docs and wiring

`docs/token-launch.md` (extend or create; check for the existing launch doc first and update it): gasless rules, both venues, the fee split, the CLI. `docs/api-reference.md` and `docs/cli.md` sections. `data/changelog.json` entry tagged `feature`.

## Acceptance

- `three-ws launch --dry-run` on the QA account prints the table for both venues; the real launch stops at the owner's yes (gate 1).
- A wallet with zero SOL completes `launch-prep --gasless` and the returned transaction is fee-paid by the platform.
- Both launch kinds appear in `/launches` with badges.
- `npm test` green.
