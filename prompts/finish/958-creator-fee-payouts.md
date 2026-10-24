Creator-fee payouts are built and committed: the signed payout wallet with step-up and 48 hour change cooldown, the distribution ledger with held reasons, the distribute and reconcile crons, owner notifications, the /creator/payouts page with CSV export and the live schedule and per-$100 explainer, and the payouts block on the public earnings API and card (docs/creator-payouts.md, tests/creator-payouts.test.js). What remains is owner-gated or needs a live environment:

1. Deploy, then sync Cloud Scheduler so the two new crons (/api/cron/creator-payout-distribute, /api/cron/creator-payout-reconcile) exist. Command: `npm run deploy:gcp:full`.
2. Exercise /creator/payouts in a real browser against the deployed API (register a wallet with a connected wallet and step-up, cancel a staged change, export the CSV). The local dev server could not start during the build because node_modules was mid-install.
3. Switch sending on with `gcloud run services update three-ws-api --region us-central1 --update-env-vars CREATOR_PAYOUTS_LIVE=true` only after the owner has looked at the first recorded distributions (until then every share is recorded and held as payouts_paused). This is the first real spend path, so it stops at the owner's explicit yes.
4. After the first live claim, confirm the reconcile cron reports no drift in creator_payout_reconcile_runs.

Delete this order once items 1 to 4 are done.
