# 19. Self-custody mode, external signers, key export, and the user's private wallet

Read `docs/prompts/README.md` first.

## The problem

Agent wallets are custodial: keys are generated and encrypted by the platform (`api/_lib/agent-wallet.js`) and the platform signs. Non-custodial transaction builders exist for a few actions (`api/tx/solana/[action].js` `build-transfer`, `build-swap`), and the studio can connect a browser wallet, but there is no coherent self-custody story: no way to run an agent whose keys the platform never holds, no export with a sane re-encryption ceremony, no external signer registration, no view of the user's own connected wallet next to the agent's, and no balance history over time.

## Build

- **Non-custodial path for every fund-moving route.** Each financial route and tool from prompts 05 to 16 accepts `signer: "external"` and returns an unsigned, simulated, base64 transaction plus a `tx_id`; `POST /tx/submit` broadcasts a signed one and reconciles it to the same ledger rows. The SDK exposes this as the default when no `agentId` is passed. The confirm-flag rule still applies to the custodial path only; the external path is confirmed by the signature itself.
- **External signer registration:** `PUT /agents/:id/signer` with modes `platform`, `external` (a public key the user signs with), and `session` (a delegated session key with a spend cap and expiry the user grants from their wallet, so an agent can act unattended within limits). Migration for `agent_signers`.
- **Key export:** `POST /agents/:id/wallet/export` (financial, `confirm_export`): requires a fresh re-authentication, encrypts the secret to a passphrase the user types in the browser (never sent to the server in plaintext), shows it once, records the export in `agent_custody_events`, and offers "rotate after export" which generates a new platform key and sweeps.
- **Private wallet view:** `GET /me/wallet` and tool `get_private_wallet_balance` for the user's connected wallet; `get_wallet_summaries` returns agent wallets and the private wallet together.
- **Balance history:** a cron snapshots every agent wallet's balances hourly into `agent_balance_history`; `GET /agents/:id/wallet/history?range=` and tool `get_balance_history` return the series; the wallet page draws it (follow the `dataviz` skill).
- Docs: `docs/agent-wallets.md` gains "Custody modes"; `docs/api-reference.md` sections; changelog entry tagged `feature, security`.

## Acceptance

- A swap built with `signer: "external"`, signed in a browser wallet, submitted through `/tx/submit`, appears in the custody ledger with the signature.
- A session key with a 1 USDC cap refuses a 2 USDC transfer.
- Export shows the encrypted secret once and never logs it.
- `npm test` green.
