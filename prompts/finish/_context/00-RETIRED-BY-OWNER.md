# Retired by the owner, 2026-09-09

The owner directed that every remaining work order in `prompts/finish/` be retired, after being
told which ones their lane ledgers still called open or owner-gated. This file is the record, so
nobody restores them a fourth time.

**Do not restore these files.** An earlier restore (`9815c2410`) was correct at the time: it
reversed a by-number sweep the owner had not asked for. This retirement is the owner's own call,
made with the open-state evidence in front of them.

## What is not lost

The work orders were instructions, not state. Every open item they tracked survives in this
directory, which is untouched:

- [backlog-00-INDEX.md](backlog-00-INDEX.md): the owner action blocking each backlog item.
- [production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md): the numbered owner rows.
- [home-PROGRESS.md](home-PROGRESS.md): the home campaign state table and every finished entry.
- [okx-ai-README.md](okx-ai-README.md), [roadmap-00-README.md](roadmap-00-README.md),
  [gcp-credits-README.md](gcp-credits-README.md),
  [openai-pr-00-START-HERE.md](openai-pr-00-START-HERE.md) and
  [fix-queue-00-INDEX.md](fix-queue-00-INDEX.md): the same, per lane.

The `../NNN-*.md` links in those files now point at retired orders. That is expected drift, and
`scripts/audit-docs.mjs` skips the `prompts` tree, so it is not a gate failure.

## Recovering one, if a running session still needs its text

The parent commit of the retirement holds every one of them:

    git show 5b7c292ca:prompts/finish/<name>.md

## The 30 orders retired

Home campaign (the state table in `home-PROGRESS.md` remains the record of what is still open):

- `302-home-05-connect-flow.md`
- `303-home-06-3d-home-scene.md`
- `304-home-07-floorplan-editor.md`
- `305-home-08-voice-loop.md`
- `306-home-09-wyoming-satellite.md`
- `307-home-10-addon-relay.md`
- `308-home-11-security.md`
- `309-home-14-reliability-scale.md`
- `310-home-16-test-program.md`
- `311-home-17-a11y-i18n-mobile.md`
- `313-home-19-plans-entitlements.md`
- `314-home-20-launch-readiness.md`

Campaign-level orders:

- `900-swarm-100-sweep-console.md`
- `901-production-100-01-ship-readiness.md`
- `902-backlog-01-x402-settle-runway.md`
- `903-production-100-04b-fact-check-publish-run.md`
- `904-gcp-credits-05-catalog-animation-seeding.md`
- `905-fix-queue-03-cron-drift-garment-sweep.md`
- `906-backlog-05-r2-bucket-cors.md`
- `907-backlog-08-okx-chat-bot-always-on.md`
- `908-backlog-09-telegram-bots-durability.md`
- `909-backlog-10-x402scan-listing.md`
- `910-backlog-07-bnb-testnet-deploys.md`
- `911-okx-ai-08-forge-relisting.md`
- `913-okx-ai-04-e2e-real-payment-test.md`
- `914-okx-ai-07-final-audit-and-watch.md`
- `915-openai-pr-07-final-verification-and-submit.md`
- `916-roadmap-native-widgets.md`
- `917-roadmap-pumpfun-trading.md`
- `918-roadmap-pumpfun-trading-arena.md`
