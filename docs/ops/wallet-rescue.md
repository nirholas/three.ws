# Wallet rescue runbook

When a wallet key leaks, a sweeper bot drains anything that lands in that wallet within seconds. The rescue therefore never funds the compromised wallet. A separate, safe **fee payer** wallet pays every fee, the rent for the destination token accounts and the Jito tip, and everything lands in one atomic Jito bundle: it all happens in one block or not at all, so nobody holding the leaked key can slip a transaction between the steps.

The `wallets-leak-scan` cron ([api/cron/wallets-leak-scan.js](../../api/cron/wallets-leak-scan.js)) raises the alarm and links here.

## What the bundle does

Up to five transactions, each self-contained:

1. Per token account: create the destination associated token account (idempotent, fee payer pays), `transferChecked` the full balance, close the source account. The closed account's rent goes straight to the destination.
2. The last transaction also returns the compromised wallet's remaining SOL to the destination and pays the Jito tip, both from the right wallet: the SOL return is signed by the compromised wallet, the tip by the fee payer.

Both Token and Token-2022 accounts are handled. Frozen accounts cannot be moved by their owner and are listed as skipped. A wallet with more token accounts than fit in five transactions is rescued in rounds: the plan prints how many remain, rerun it after the bundle lands.

## 1. Dry run (safe, public keys only)

```sh
node scripts/rescue-wallet.mjs \
  --compromised <leaked wallet> \
  --destination <safe wallet> \
  --fee-payer <safe wallet with SOL> \
  --rpc <mainnet RPC url>
```

Nothing is signed or sent and no secret key is needed. The script reads the compromised wallet's balances, builds the bundle, simulates every transaction against the chain, and prints the plan: tip, SOL return, each token account moved, compute units, and whether the live Jito tip accounts still match the pinned list. Exit code 0 means every simulation passed, 2 means one failed.

Options: `--tip-sol` (default 0.001, clamped to `MAX_JITO_TIP_SOL`), `--priority` (micro-lamports per compute unit), `--no-sol` (leave the SOL), `--json`.

The fee payer needs roughly 0.002 SOL per destination token account that does not exist yet, plus fees and the tip. The simulation checks this for real; a fee payer that is too poor shows up as a failed simulation.

The destination must pass `RECIPIENT_ALLOWLIST` if one is configured. The fee payer must not be the compromised wallet.

## 2. Execute (owner action, moves real funds)

`--execute` signs and sends. It is a stop-and-ask action: render the plan above, get an explicit yes from the owner, then:

```sh
RESCUE_COMPROMISED_SECRET=<base58> RESCUE_FEE_PAYER_SECRET=<base58> \
  node scripts/rescue-wallet.mjs --execute <same flags as the dry run>
```

It refuses to run without an interactive terminal, without a passing simulation, or if the secrets do not match `--compromised` and `--fee-payer`. It then asks you to type the destination address back. After you confirm it rebuilds and re-simulates against the current blockhash, signs, and submits the bundle. If the result is `pending`, check the signatures on Solscan before resubmitting.

After a landed rescue: rotate every credential that shared the key's custody (see [wallet-key-migration.md](wallet-key-migration.md)), and revoke any token delegations the attacker may hold.

## Jito tip accounts

Every tip goes to one of the block engine's tip accounts. [jito-tip-accounts.js](../../packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js) is the single source for the rescue, the MCP bundle tools and `api/_lib/execution-engine.js`. It reads `getTipAccounts` from the block engine (`JITO_BLOCK_ENGINE_URL`, default mainnet), caches it for ten minutes, refreshes in the background so hot paths never wait on the network, and serves a pinned list when the engine is unreachable.

The dry run prints the drift check:

| Status | Meaning | Action |
| --- | --- | --- |
| `ok` | Live set equals the pinned set | none |
| `drift` | Jito rotated its accounts | live accounts already serve tips; update the pinned list and the canonical set in `tests/jito-tip-accounts.test.js` |
| `unverified` | Engine unreachable | the pinned list keeps serving; rerun later |

## Tests

`npx vitest run tests/atomic-rescue.test.js tests/jito-tip-module.test.js tests/jito-tip-accounts.test.js` covers bundle construction (instruction order, signers, who pays what, size limits, deferral, frozen accounts, refusals) and the tip module (live read, cache, fallback, drift). None of them send anything.
