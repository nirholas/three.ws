Creator-fee payouts are built, committed and live in production (revision three-ws-api-00535-6pd, commit 518f61469 and later): the signed payout wallet with step-up and 48 hour change cooldown, the distribution ledger with held reasons, the distribute and reconcile crons, owner notifications, the /creator/payouts page with CSV export and the live schedule and per-$100 explainer, and the payouts block on the public earnings API and card (docs/creator-payouts.md, tests/creator-payouts.test.js).

Done and verified 2026-11-14:

- Deployed, and both Cloud Scheduler jobs exist and succeed (cron--api-cron-creator-payout-distribute hourly at :20, cron--api-cron-creator-payout-reconcile every 3 hours at :50; 169 reconcile runs, all ok).
- /creator/payouts exercised in a real browser against production as the QA account: registered a wallet (connect, password step-up, Ed25519 signature), staged a change, cancelled it, CSV endpoint and public payouts block checked, no console errors, every API call 2xx. Rerun with `npm run audit:web:login && node scripts/creator-payouts-prod-e2e.mjs`.

Blocker found upstream, owner decision: there is nothing to distribute yet. The distributor ingests only `launcher_claims`, written by `/api/cron/launcher-claimer`, which claims only for `launcher_runs` rows with a mint. As of 2026-11-14 no launcher run has ever minted (25,290 dry_run, 213 skipped, 16 failed, 3 pending), so `launcher_claims` and `creator_payout_distributions` are both empty. Meanwhile the 92 agent coins in `pump_agent_mints` do accrue creator fees (`agent_coin_earnings`: 53 coins over the 0.01 SOL claim threshold), but they are not launcher runs, so neither the claimer nor payouts sees them. Either the global launcher starts minting, or the claimer is extended to agent coins whose creator is the agent's custodial wallet (that extension claims on-chain, so it needs the owner's yes first).

What remains:

1. Once the first claims land and the distribute cron has recorded them (held as payouts_paused), the owner reviews them, then switches sending on with `gcloud run services update three-ws-api --region us-central1 --update-env-vars CREATOR_PAYOUTS_LIVE=true`. This is the first real spend path, so it stops at the owner's explicit yes.
2. After the first live payout, confirm the reconcile cron reports no drift in creator_payout_reconcile_runs.

Delete this order once items 1 and 2 are done.
