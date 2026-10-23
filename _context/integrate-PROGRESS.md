# Integrate work-order progress

## 2026-10-23: integrate 47, wallet rescue dry run

- Tip accounts: one module (`packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js`) reads the block engine's `getTipAccounts` with a pinned fallback; `jito.js` and `api/_lib/execution-engine.js` use it. Landed in 22a5a1f49 (swept into another agent's commit).
- Rescue: `scripts/rescue-wallet.mjs` and `packages/avatar-agent-mcp/src/lib/atomic-rescue.js` (dry run default, `--execute` gated). Landed in 22a5a1f49.
- Runbook `docs/ops/wallet-rescue.md`, alarm link in `api/cron/wallets-leak-scan.js`, docs index, STRUCTURE row, changelog entry: see the commit that deletes `prompts/finish/546-integrate-47-wallet-rescue-dry-run.md`.
- Dry run was executed against a local solana-test-validator wallet set (devnet faucet was rate limited), not devnet.

## 2026-10-23: integrate 33, keyless X guest read rung (not closed)

- Built: `api/_lib/x-guest/` (guest-token reader, NOTICE, README), rung 2 in `src/kol/x-profile.js`, `api/_lib/oracle/x-account.js` (coin X account age and followers into `social.xAccount`), `api/_lib/oracle/social-feed.js`, `api/cron/oracle-social-ingest.js` plus its `vercel.json` cron (every 10 min), docs, STRUCTURE row, changelog. The code landed inside other agents' sweep commits (22a5a1f49, 2b7bb3921); the cron-count fix in CLAUDE.md is the commit that touches this entry.
- Verified: vitest on x-guest, kol-leaderboard, oracle sources and sources-assemble, 41 passing (run from an isolated install, see below). Live with the bearer unset: `fetchXProfile` returned followers with source `x-guest`; the cron read a real timeline and exited 200.
- Not verified, so prompts/finish/532 stays: (1) `curl /api/kol/tracker` and (2) the cron writing `oracle_narrative` rows both need the server and a database; this checkout has no `DATABASE_URL` and `node_modules` could not boot `server/index.mjs`. Owner of the remainder: whoever has the DB env, run `node server/index.mjs` with `--env-file`, hit `/api/kol/tracker`, then the cron.
- `npm run build:pages` currently fails on another agent's changelog entry ("See whether our X posts move $THREE") which uses `tag` instead of `tags`.
- Incident: my `npm ci` raced about 35 concurrent npm processes and left the shared `node_modules` incomplete (vitest, lru-cache missing). Run `npm ci` once when no other agent is installing.
