# Staked Event Markets: mainnet launch runbook

Staking is built and off. This is the owner's path from the proven devnet build to mainnet. Every step that spends SOL, moves tokens or changes production is a gate: print the table, read it, then say yes.

The authoritative, always-current version of the sequence is the read-only script:

```sh
node --env-file=.env scripts/event-markets-stake-launch-plan.mjs        # ordered steps with your values filled in
node --env-file=.env scripts/event-markets-stake-launch-plan.mjs --json
```

It prints a preflight table (cluster, program id and build hash, keys present and distinct and not economy wallets, migration, flag off, RPC, an open market exists, reconciliation clean) and exits 1 until every check passes. Nothing in it sends or writes.

## Audit checklist

- The program (`contracts/event-markets-stake/`, about 600 lines of Anchor 0.31) is unaudited. Do not deploy to mainnet before an external review of: pool and vault PDAs, the fee split, payout rounding (`vault == totalStaked - feePaid - paidOut`), the lock and void paths including permissionless `void_expired`, and Token-2022 handling.
- Counsel sign-off on jurisdiction, minimum age (default 21), KYC, and whether a buyback funded by wagering fees changes how $THREE is characterized. Blocked regions default in `api/_lib/event-markets/staking/config.js`.
- Record the audited build hash: `sha256sum contracts/event-markets-stake/target/deploy/event_markets_stake.so`. After deploying, `solana program dump <id> dump.so --url mainnet-beta && sha256sum dump.so` must match.

## Key custody

Three distinct keys, none of them a platform economy wallet (the preflight enforces this): authority (config, pause), resolver (create pool, lock, resolve, void), buyback wallet (receives the buyback half of the fee, runs `buyback`). Generate on a hardware-backed signer, keep the files outside the repo, and point `EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR`, `EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR` and `EVENT_MARKETS_STAKE_BUYBACK_KEYPAIR` at them for the shell that runs the CLI only. Production never needs these keys: the server builds unsigned transactions and never signs for anyone.

## Command list

All commands run through `scripts/event-markets-stake-admin.mjs`. Without `--yes` they print the confirmation table and "Dry run". On mainnet they refuse without `--confirm-mainnet` even with `--yes` (covered by `tests/event-markets-staking-buyback.test.js`).

| Step | Command | Expected |
|---|---|---|
| Deploy | `cd contracts/event-markets-stake && cargo build-sbf && solana program deploy target/deploy/event_markets_stake.so --program-id target/deploy/event_markets_stake-keypair.json --url mainnet-beta` | program id `6DsLYSQcYZSegSKgRkRMP93L7uHxvV1cQhm6YoXa9xXU` |
| Migrate | `npm run db:status && npm run db:migrate` (20261013000000) | four `event_market_stake_*` tables |
| Init | `init --treasury <pubkey> --buyback <pubkey> --yes --confirm-mainnet` | `sent <signature>`; `status` shows `paused: false`, fee 300 bps, buyback share 5000 bps |
| Pool | `create-pool --market <slug> --token usdc --yes --confirm-mainnet` | table with stake limits and lock time, then `pool recorded`; no funds move |
| Enable | `gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKETS_STAKING_ENABLED=1,EVENT_MARKETS_STAKE_CLUSTER=mainnet,EVENT_MARKETS_STAKE_PROGRAM_ID=<id>` | the staking panel appears for attested viewers outside blocked regions |
| Resolve | `resolve --market <slug> --yes --confirm-mainnet` (or `void`) | fee to treasury and buyback; winners claim their own payouts |
| Buyback | `buyback --yes --confirm-mainnet` | USDC in the buyback wallet swapped to $THREE via Jupiter |

Use `--update-env-vars`, never `--set-env-vars` (it replaces the whole env set).

### The $THREE buyback

`buyback` reads the USDC balance of the buyback wallet (it must be the buyback recipient in the on-chain config), quotes a swap to $THREE through the platform's existing Jupiter path (`api/_lib/vault-jupiter.js`), and prints the wallet, USDC in, expected $THREE out, the enforced minimum out, slippage and price impact. Bounds: `--max-slippage-bps` (default 100, hard range 1 to 500) and `--max-impact-pct` (default 2, hard cap 10); it refuses a quote beyond them and refuses a quote whose enforced threshold is below the computed minimum. `--amount <usdc>` spends part of the balance. Jupiter routes mainnet liquidity only, so on devnet the command stops at the quote with a clear message.

## Proving it on devnet first

```sh
node scripts/deploy-solana-programs.mjs --cluster devnet --keypair .deploy/devnet-payer.json --yes   # needs devnet SOL
node scripts/event-markets-stake-devnet-e2e.mjs --payer .deploy/devnet-payer.json
```

The e2e script needs about 3 devnet SOL on the payer (faucet.solana.com). It creates an SPL and a Token-2022 test mint, then runs stake x3, lock, resolve, claim (payout equal to the pool formula to the base unit), void with refunds, and `void_expired`, printing every signature and asserting zero reconciliation drift.

## Monitoring

- Cron `/api/cron/event-markets-staking-reconcile` (every 10 minutes) syncs each pool's ledger from the chain and alerts the ops channel on any mismatch. A short vault is the alarm case.
- Admin page `/admin/event-markets-staking` shows the same reconciliation plus the kill switch. The route is admin-only (`tests/event-markets-staking-admin-gate.test.js`).
- Spot check: `status` on the CLI lists the config and every pool's on-chain state.

## Rollback

1. Turn the flag off: `gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKETS_STAKING_ENABLED=0`.
2. Stop new stakes instantly: admin page Pause, or `pause --yes --confirm-mainnet`. Claims and refunds keep working.
3. `void --market <slug> --yes --confirm-mainnet` on any open pool so every staker refunds in full with no fee. Pools also void themselves 7 days after the lock if unresolved.
