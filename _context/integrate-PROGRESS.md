# Integrate work-order progress

## 2026-10-23: integrate 47, wallet rescue dry run

- Tip accounts: one module (`packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js`) reads the block engine's `getTipAccounts` with a pinned fallback; `jito.js` and `api/_lib/execution-engine.js` use it. Landed in 22a5a1f49 (swept into another agent's commit).
- Rescue: `scripts/rescue-wallet.mjs` and `packages/avatar-agent-mcp/src/lib/atomic-rescue.js` (dry run default, `--execute` gated). Landed in 22a5a1f49.
- Runbook `docs/ops/wallet-rescue.md`, alarm link in `api/cron/wallets-leak-scan.js`, docs index, STRUCTURE row, changelog entry: see the commit that deletes `prompts/finish/546-integrate-47-wallet-rescue-dry-run.md`.
- Dry run was executed against a local solana-test-validator wallet set (devnet faucet was rate limited), not devnet.
