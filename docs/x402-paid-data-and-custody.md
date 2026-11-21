# Paid data and wallet custody for the x402 loop

Two guarantees for everything the x402 loop does with money:

1. **Every response we pay for is kept.** The full body of every paid x402 call,
   with its receipt (tx signature, payer wallet, amount, endpoint, pipeline), is
   stored so we can do our own accounting and use the data we bought again.
2. **No wallet the loop creates can be lost.** Every key has two independent
   encrypted copies, the database refuses to delete or re-key a wallet, and a
   daily audit proves every key still opens.

## The paid-response store

`payX402` ([api/_lib/x402/pay.js](../api/_lib/x402/pay.js)) is the one function
every pipeline pays through, so the capture lives there: after a PAID result and
before it returns, it calls `recordPaidResponse`
([api/_lib/x402/paid-responses.js](../api/_lib/x402/paid-responses.js)). All
pipelines are covered with no per-pipeline wiring. A caller adds context through
`payX402`'s `capture` option (`pipeline`, `runId`, `endpointKey`, `walletKind`,
`freshWalletId`) and can opt out with `capture: false`. The result carries
`result.capture` (`{ stored, where, sha256 }`).

Tables (migration
[20261121120000_x402_paid_responses.sql](../api/_lib/migrations/20261121120000_x402_paid_responses.sql)):

| Table | One row per | Notes |
| --- | --- | --- |
| `x402_paid_response_bodies` | distinct body | Keyed by the sha256 of the canonical JSON, so the same dataset bought twice is stored once. Bodies up to 1 MB are `jsonb` inline; larger ones go to object storage at `x402-paid/<sha[0:2]>/<sha>.json` (inline anyway if that upload fails). |
| `x402_paid_responses` | paid call | Receipt: `tx_sig` (unique, so a call is booked once), pipeline, url, endpoint, request body, status, payer, `wallet_kind`, `fresh_wallet_id`, amount, asset, network, body sha256, run id, duration. |

Both tables are guarded by triggers: rows cannot be deleted or truncated, a
stored body never changes, and a receipt's tx signature and body hash cannot be
rewritten.

**When the database is down** the record is spooled to object storage under
`x402-paid-spool/<day>/`. The daily cron and `npm run x402:paid-data -- ingest-spool`
replay the spool; each spool object is deleted only after its receipt is
confirmed in the database, and an envelope whose body does not match its sha256
is kept and reported. The spool is listed in both R2 and the GCS fallback bucket
(`STORAGE_FALLBACK_BUCKET`), because writes land in the fallback while R2 refuses
the credential. Storing never throws: a store fault cannot turn a settled
payment into a crash.

### Using the data

```bash
npm run x402:paid-data -- summary --prod-env [--since 2026-11-01]
#   per endpoint: calls, spend, payers, distinct bodies, bytes, last purchase
npm run x402:paid-data -- export --prod-env --out paid.jsonl [--endpoint /api/x | key] [--pipeline P] [--since D] [--no-bodies]
#   one JSON line per paid call with its full body, oldest first
npm run x402:paid-data -- accounting --prod-env [--since D] [--until D] [--csv wallets.csv]
#   per-wallet ledger: paid, responses, endpoints; fresh wallets add USDC funded and
#   returned, SOL funded and reclaimed, rent reclaimed, and the fund/pay/sweep sigs
npm run x402:paid-data -- ingest-spool --prod-env
```

In code: `listPaidResponses` (paged receipts with bodies), `loadPaidBody`,
`paidDataSummary` and `walletAccounting` in
[paid-responses.js](../api/_lib/x402/paid-responses.js).

## Wallet custody

Covers both wallet tables the loop writes: the payer pool (`x402_ring_pool`) and
the one-shot fresh wallets (`x402_fresh_wallets`, including the per-call ring
payer). Code: [api/_lib/x402/wallet-custody.js](../api/_lib/x402/wallet-custody.js).

| Copy | Column | Sealed with |
| --- | --- | --- |
| Primary | `encrypted_secret` | secret-box under `WALLET_ENCRYPTION_KEY` (env) |
| Backup | `backup_secret` | Cloud KMS envelope (`kms1:`): a per-wallet AES-256-GCM data key wrapped by `X402_WALLET_BACKUP_KMS_KEY` |

The KMS key cannot be exported or changed by an env edit, so losing or rotating
`WALLET_ENCRYPTION_KEY` no longer loses a loop wallet.

- **At mint** `sealNewWalletKey` seals both copies and proves each reopens to the
  wallet's own pubkey before the row is written. With the backup key configured
  and KMS refusing, the mint fails closed: no wallet ever holds value with only
  one copy.
- **At signing** `recoverWalletKeypair` opens the primary, falls back to the KMS
  copy, and only returns a key that matches the row's pubkey.
- **In the database** (migration
  [20261121120100_x402_wallet_custody.sql](../api/_lib/migrations/20261121120100_x402_wallet_custody.sql)):
  wallet rows cannot be deleted or truncated, a pubkey never changes, a key copy
  cannot be blanked, and any replaced ciphertext is archived in the append-only
  `x402_wallet_key_history`.
- **Daily audit** ([api/cron/x402-wallet-custody-audit.js](../api/cron/x402-wallet-custody-audit.js),
  04:41 UTC): opens both copies of every wallet, backfills the KMS copy for
  wallets minted before it existed, stamps `custody_verified_at`, drains the
  paid-data spool, and sends an ops alert for any wallet that opens from neither
  copy, only from the backup, or has a backup fault. Alerts and reports carry
  pubkeys only, never key material.

### The KMS key

`projects/aerial-vehicle-466722-p5/locations/us-central1/keyRings/x402-wallet-custody/cryptoKeys/wallet-backup`:
symmetric, rotated every 90 days (old versions keep decrypting), and a version
destroy waits 120 days before it takes effect. The runtime service account
`three-ws@` holds `roles/cloudkms.cryptoKeyEncrypterDecrypter` on it. Turn the
backup on with a config-only update:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars X402_WALLET_BACKUP_KMS_KEY=projects/aerial-vehicle-466722-p5/locations/us-central1/keyRings/x402-wallet-custody/cryptoKeys/wallet-backup
```

### Operator commands

```bash
npm run x402:wallet-custody -- --prod-env                   # audit, prints pubkeys and statuses
npm run x402:wallet-custody -- --prod-env --backfill        # also write missing KMS copies
npm run x402:wallet-custody -- --prod-env --reseal-primary  # primary lost (env key rotated): re-seal it from the KMS copy
node scripts/x402-custody-live-check.mjs                    # proves the whole chain against the real KMS key on a throwaway DB
```

The CLI calls KMS as your own gcloud login, which needs
`cloudkms.cryptoKeyEncrypterDecrypter` on the key. It exits 2 when anything
needs attention. A re-seal is reversible: the replaced ciphertext is in
`x402_wallet_key_history`.

## Env

| Var | Effect |
| --- | --- |
| `X402_WALLET_BACKUP_KMS_KEY` | Full KMS crypto-key name for the backup copy. Unset: primary copy only, and the audit does not ask for backups. |
| `WALLET_ENCRYPTION_KEY` | Primary copy key (shared with the rest of the platform's custodial keys). |
| `STORAGE_FALLBACK_BUCKET` | GCS bucket the spool and large bodies land in while R2 is down. |

## Related

- [Closed-loop x402 ring economy](./x402-ring-economy.md)
- [Fresh-wallet workers](./x402-fresh-workers.md), including the per-call fresh payer and its headroom gate
