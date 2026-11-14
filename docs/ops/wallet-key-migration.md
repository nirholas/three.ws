# Incident: stranded pool-agent wallets after the WALLET_ENCRYPTION_KEY migration

Date range: keys introduced 2026-06-19, pool agents created 2026-06-26, migration to
Cloud Run 2026-07-07, diagnosed + resolved 2026-07-12.

> **Cause corrected 2026-09-16, after this record was written.** The measurement
> behind the diagnosis below did not hold up: every wallet the production API
> wrote in June 2026 opens with today's production key, and wallets kept getting
> sealed long after the migration. The sealing writes came from deployments that
> shared the production database while carrying their own key, not from a key
> the migration dropped. The corrected brief, the evidence, and the recovery path
> are in [stranded-wallets.md](stranded-wallets.md). Read this page as the record
> of what was believed and done at the time; the rotation mechanics, the
> fund-safety guard, and the secret-storage runbook below are all still current.

## What happened

Custodial Solana wallets for the pump.fun launch-pool agents (`launcher_queue`, scope
`global`) are encrypted at rest with `WALLET_ENCRYPTION_KEY` (AES-256-GCM, `secret-box.js`).
The pool agents were created 2026-06-26, after the key scheme (introduced 2026-06-19) and
its production guard (added 2026-06-21, which requires a dedicated ≥32-char key and refuses
the `JWT_SECRET` fallback) were both already active — so those 12 wallets were sealed under
a dedicated key that existed only in the pre-migration Vercel runtime.

The 2026-07-07 Vercel → Cloud Run migration did not carry that key forward. Cloud Run's
Secret Manager `WALLET_ENCRYPTION_KEY` has only one version, created on the migration date
itself — a newly generated key, not the one the pool wallets were encrypted under. Every
autonomous launch attempt against those 12 wallets failed with a definitive AES-GCM
`OperationError` (auth-tag mismatch — proof of a wrong key, not a transient fault).

## Recovery attempt

Searched every place the pre-migration key could plausibly still exist:

- GCP Secret Manager — `WALLET_ENCRYPTION_KEY` and `JWT_SECRET`, all versions: only the
  2026-07-07 (post-migration) version exists for either.
- Vercel env (CLI export) — `WALLET_ENCRYPTION_KEY` was not present at all (never set, or
  deleted); `JWT_SECRET` was present but exported empty.
- Owner-supplied candidates (current deploy key, one manually recalled value) — both tried
  against the stranded wallets' ciphertext; neither decrypted.
- Prior scratch/staging notes from the migration itself — only the current key.

No copy of the pre-migration key was recoverable from any automated source. It exists only
in the pre-July-7 Vercel runtime's own secret store (source data, not exported as
plaintext) or a personal backup outside this codebase, and the owner did not have one on
hand.

## Fund-safety guard (shipped before any wallet was touched)

Before re-keying anything, a fail-closed guard went into `loadAgentForSigning`
(`api/_lib/agent-pumpfun.js`): on a definitive decrypt failure (`isUnrecoverableSecret`),
it checks the stranded wallet's on-chain SOL balance via public RPC before doing anything
else.

- Balance **read fails** (RPC error) → refuse to touch the wallet, return `503
  stale_balance_unverified`. Never mistake "can't check" for "empty."
- Balance **> 0.01 SOL** → refuse to re-key, return `409 wallet_funds_stranded` with the
  address and balance, so it surfaces for manual recovery instead of silently vanishing.
- Balance **≤ 0.01 SOL** (dust or empty) → safe to self-heal: mint a fresh wallet under the
  current key, keep the dead address in `meta.stale_solana_address` for the audit trail.

Same logic in the batch tool, `scripts/rekey-stale-launch-wallets.mjs`: dry-run by default,
skips any wallet holding more than dust unless `--force-drop-funds` is passed explicitly.
Covered by `tests/agent-wallet-rekey-guard.test.js` (4 cases) and
`tests/economy-rebalance.test.js`.

## Outcome

Total stranded across the 12 pool wallets: **1.41 SOL**, confirmed unrecoverable — no valid
key exists in any system this platform controls. The owner made the call to abandon that
balance (it cannot be spent or moved without the retired key regardless) and re-key the
pool so autonomous launches resume. `scripts/rekey-stale-launch-wallets.mjs --apply
--force-drop-funds` was run once that decision was made: every undecryptable wallet was
re-provisioned under the current `WALLET_ENCRYPTION_KEY`, the dead address preserved in
`meta.stale_solana_address` on each row, and wallets that already decrypted correctly were
left untouched.

## The mechanism that makes the next rotation survivable (2026-08-01)

The takeaway below ("carry the old key forward") had no mechanism behind it, so it was a
rule a human had to remember at exactly the moment they were busy migrating hosts. It is
now enforced by the code.

`WALLET_ENCRYPTION_KEY_PREVIOUS` holds retired keys, newest first, comma or whitespace
separated. `secret-box.js` tries the current dedicated key, then every retired key, then
`JWT_SECRET`, for both v2 and legacy v1 ciphertexts. **Encryption is unchanged**: new
writes always use the current key, so a rotation upgrades records as they are rewritten and
a retired key can be dropped once an audit shows nothing opens with it.

Rotating safely is now three steps:

```sh
# 1. Keep the outgoing key readable BEFORE the new one takes over.
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars WALLET_ENCRYPTION_KEY_PREVIOUS=<the outgoing key>

# 2. Rotate.
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars WALLET_ENCRYPTION_KEY=<the new key>

# 3. Confirm nothing is stranded, then (later) drop the retired key.
node scripts/audit-custodial-key-health.mjs
```

Never `--set-env-vars` here: it replaces the entire environment set. Covered by
`tests/secret-box.test.js` (retired-key read, stacked rotations, and a case proving new
writes never use a retired key).

Step 1 is now load-bearing for a second reason. Since 2026-09-16 `secret-box.js` binds a
database to the key that writes into it: the first encrypt records an HMAC fingerprint of
the key in `app_settings` (`secret_box_write_key`), and any later process holding a
different key is refused with `secret_box_key_mismatch` instead of minting a wallet nobody
can open. A rotation that puts the outgoing key in `WALLET_ENCRYPTION_KEY_PREVIOUS` first
moves that fingerprint forward; a rotation that skips step 1 fails its next custodial write
outright. The fingerprint is one-way, so storing it reveals nothing. If a wallet is already
sealed under a key you have since recovered,
`scripts/recover-sealed-wallets.mjs` re-encrypts it in place under the current key, keeping
the address and moving no funds.

**What this does not do:** it cannot recover the keys already lost. A re-measure on
2026-08-01 (`scripts/audit-custodial-key-health.mjs`) found 8 of 565 custodial wallets
still unopenable, holding **0.49 SOL, of which 0.35 SOL is customer money** in two
user-owned agents. Those users cannot withdraw. Re-keying a customer wallet would abandon
their balance, so that decision is the owner's, not an agent's.

## Still stranded, and a blind spot in how we knew that (2026-08-09)

A production triage sweep hit this incident again from a new angle: `treasury-topup`'s
live agent-reclaim leg tried to sweep two platform pool wallets (Atlas #22, Echo #22,
both created 2026-06-26, the same batch as the original 12) that showed real balances
(0.068 and 0.054 SOL) and failed with `secret_undecryptable` on both. Same root cause,
same unresolved batch, not a new incident.

What was new: `scripts/audit-custodial-key-health.mjs`, run locally in this codespace at
the same time, reported "0 SOL stranded" for the whole fleet, flatly contradicting the
live reclaim failure. The audit was wrong for two independent reasons, both now fixed:

1. It hit exactly one hardcoded `SOLANA_RPC_URL` lane (`rpc.magicblock.app`) with no
   fallback. That lane returned `403 Forbidden` for this caller's IP, so every balance
   read failed. The script now uses `solanaConnection()` from
   `api/_lib/solana/connection.js`, the same rotating multi-lane connection production
   reads balances through, so one blocked or rate-limited lane no longer blinds the
   whole audit.
2. Worse, an unread balance was silently summed as zero (`balances.get(addr) || 0`), so
   a total RPC failure printed a confident "SOL stranded: 0" instead of "unknown." The
   script now tracks reads with `balances.has()` and refuses to print a stranded total
   while any undecryptable wallet's balance is unconfirmed; `scripts/gcp-triage.mjs`'s
   `custodial-keys` probe carries the same guard, so the deep sweep no longer reports
   `ok` off an unread balance either.

A third blind spot of the same family closed on 2026-09-02: the audit needs a
decryption key of its own, and it had no idea whether it had one. Run in a shell with
no `WALLET_ENCRYPTION_KEY` (a fresh clone, or this codespace, whose `.env.local`
carries only `DATABASE_URL`), it decrypted nothing, reported **725 of 725 wallets
undecryptable and 8.57 SOL stranded**, and printed the customer-escalation banner. Every
number was an artifact of the missing key, not a measurement of production. The script now
calls `secretBoxKeyCandidates()` before it touches the database and aborts with exit 3 and
the places to find the key when the candidate list is empty, and when a key IS configured
but opens nothing at all it says a fleet-wide 100% failure is one wrong key rather than a
mass incident. Reading a stranded verdict off a keyless run is no longer possible.

With the fix, the audit reads correctly again: **8 undecryptable wallets, 0.49 SOL
stranded (0.35 SOL customer, 0.14 SOL platform)**, matching the 2026-08-01 measurement
almost exactly. Nothing changed in the underlying incident: the customer-fund decision
documented above (re-keying abandons the balance; that call is the owner's) is still
open, and no funds were moved.

## Where the wallet secrets live now, and how to rotate one (2026-09-02)

The incident above is about a key we could not read any more. This section is about the
opposite failure: a key that was readable by too many people.

`ECONOMY_MASTER_SECRET_BASE58` is the base58 secret key of the economy master wallet
(`WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`), the funding root every other Solana
engine is topped up from (`api/_lib/economy-master.js`, cron `api/cron/treasury-topup.js`).
It sat on the `three-ws-api` Cloud Run service as a **plaintext literal**, so any principal
holding `run.services.get` on `aerial-vehicle-466722-p5` could read the private key of a
funded mainnet wallet straight out of the service config, without ever touching Secret
Manager. It is now a `secretKeyRef`.

### The end state

| | |
|---|---|
| Secret | `wallet-economy-master-b58` (it already held this exact value, so no new version was minted) |
| Reference | `ECONOMY_MASTER_SECRET_BASE58 = wallet-economy-master-b58:latest` |
| Who can read it | `three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com`, granted `roles/secretmanager.secretAccessor` **on that one secret**, never project-wide |
| Landed on | revision `three-ws-api-00405-z6c`, 100% of traffic |

Read the current state at any time with `node scripts/migrate-plaintext-secrets.mjs --verify`.

### The rest of the service went with it

The master key was not the only credential sitting in the config. The same sweep moved
**58 more**, in two updates (`three-ws-api-00406-nlg`, then `00407-m7c` for one that a
killed earlier run had left as a version-less secret shell). The service now carries **81 Secret
Manager references (22 of them predating this work) and zero plaintext credentials**, with
126 of its 207 variables correctly still plaintext config; `node
scripts/migrate-plaintext-secrets.mjs --verify` reports `Verify: clean` and exits 0.

Four vars were pointed at a secret that already existed rather than a fresh copy, because
duplicating a live credential means a later rotation can update one copy and silently leave
the other serving: `ECONOMY_MASTER_SECRET_BASE58` and `LAUNCHER_MASTER_SECRET_KEY_B64` and
`X402_TREASURY_SECRET_BASE58` to their `wallet-*` secrets, and `DATABASE_URL` to the
existing `DATABASE_URL` secret. The tool reports every other value collision it finds but
never adopts one on its own: several of the matches are secrets belonging to OTHER services
in this project (`agent-orders-*`, `sniper-*`), and pointing this service at one of those
would couple two rotations that have no business being coupled.

126 vars stayed as plaintext config, correctly: public identifiers (`ECONOMY_MASTER_ADDRESS`,
`X402_FEE_PAYER_SOLANA`, every `SIGNER_*` threshold and `X402_*` cap), handles rather than
values (every `*_KEY_ID`, which names a credential without being one), and 19 provider URLs. The URLs were the one
judgment call worth making by measurement rather than by name: each value was checked for an
embedded credential (a `?api-key=`-style parameter, or userinfo before the host) and only
`DATABASE_URL` carried one, so only it moved. That check is what the tool applies now, so a
future URL that does embed a key is classified as the credential it is.

Two things the sweep surfaced that are NOT fixed here, because both need an owner decision:

- `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` hold the **same value** on production (tooling and runbook
  now exist: see "Dedicated-key re-seal" below; applying it is the owner's step). The
  custodial-wallet guard in `secret-box.js` requires a dedicated key and refuses the
  `JWT_SECRET` fallback, and a var set to the same string passes that guard while defeating
  its point. Changing it is a re-key, not a config edit: see the top of this file for what
  happens when a wallet-encryption key changes without carrying the old one forward.
- `X402_SEED_SOLANA_SECRET_BASE58` holds the same value as `LAUNCHER_MASTER_SECRET_KEY_B64`,
  though `scripts/wire-master-wallet.mjs` assigns those two slots to different wallets. They
  were given separate secrets rather than one shared secret so the drift can be corrected
  later without a rotation touching both.

### The tool, and the Cloud Run gotcha it encodes

`scripts/migrate-plaintext-secrets.mjs` does the whole move: it classifies every env var on
the service, reuses the Secret Manager secret that already holds a value rather than minting
a second copy of it, grants the runtime service account access to that one secret, flips the
service in a single update, and then re-reads the service to prove no plaintext literal
survived and that the new revision serves 100% of traffic. It is a dry run unless you pass
`--apply`, and it never prints, logs, or writes a secret value.

The gotcha it exists to encode: **Cloud Run refuses to retype an env var in place.** An
update that only sets `--update-secrets` on a name that is currently a literal fails with

```
Cannot update environment variable [X] to the given type because it has already been set with a different type.
```

The literal has to be dropped in the SAME update (`--remove-env-vars X --update-secrets
X=<secret>:latest`), which lands as one revision, so the variable is never missing from a
serving container. Two separate updates would ship a revision with the var absent.

### Adding a new version of an existing secret

```sh
# Never pass a secret as a CLI argument; feed it on stdin.
printf %s "<the new value>" | gcloud secrets versions add wallet-economy-master-b58 \
  --data-file=- --project aerial-vehicle-466722-p5
```

The service points at `:latest`, so a new version takes effect on the **next revision**, not
immediately. Force one with a config-only update:

```sh
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-secrets ECONOMY_MASTER_SECRET_BASE58=wallet-economy-master-b58:latest
```

### Rotating the master wallet (owner-gated, do not run unattended)

Migrating storage is config work. **Rotating is not**: it generates a new keypair and moves
real mainnet SOL, which is CLAUDE.md stop-and-ask gate 1. An agent prepares this and stops;
the owner runs it, or explicitly approves each transfer.

The old value was a plaintext literal for some window, so it should be treated as exposed to
everyone who has held project viewer access in that period. Whether that warrants a rotation
is a judgment call about who those principals are: it is logged as an owner decision in
`prompts/finish/_context/production-100-OWNER-ACTIONS.md`.

If the owner decides to rotate:

```sh
# 1. Generate the new keypair OFFLINE and keep a durable copy. Nothing here reads
#    it back later: a secret version's value is unreadable to anyone without the
#    accessor role, and a lost key is a stranded wallet (see the top of this file).
solana-keygen new --no-bip39-passphrase --outfile new-master.json
solana-keygen pubkey new-master.json          # the address funds will move TO

# 2. Fund the new wallet and drain the old one. OWNER-GATED, every transfer
#    confirmed individually: this is real mainnet SOL leaving a funded wallet.
#    Leave the old wallet enough SOL to pay its own transaction fees.

# 3. Publish the new secret as a version of the SAME secret, so nothing else has
#    to be re-pointed.
printf %s "<new base58 secret>" | gcloud secrets versions add wallet-economy-master-b58 \
  --data-file=- --project aerial-vehicle-466722-p5

# 4. Update the advertised address in the same update as the new revision, so the
#    key and the address it derives to never disagree on a serving container.
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars ECONOMY_MASTER_ADDRESS=<new pubkey> \
  --update-secrets ECONOMY_MASTER_SECRET_BASE58=wallet-economy-master-b58:latest

# 5. Prove the new key is the one production signs with: the treasury sweep writes
#    a heartbeat row to economy_master_ledger on every run, carrying the pubkey it
#    derived from the loaded secret.
node --env-file=.env.local -e "import('./api/_lib/db.js').then(async(m)=>{const sql=m.sql||m.default;\
  console.log(await sql\`select ts,event,master_pubkey from economy_master_ledger order by ts desc limit 3\`);process.exit(0)})"

# 6. Only once step 5 shows the NEW pubkey and the old wallet is empty, disable the
#    old version so a rollback cannot silently resurrect a drained wallet.
gcloud secrets versions disable <old version number> --secret=wallet-economy-master-b58 \
  --project aerial-vehicle-466722-p5
```

Never `--set-env-vars` in any of these: it replaces the whole environment set.

### Verifying a migration did not break anything

Storage moves are invisible until they are not, so both readings below are taken against the
live site, not assumed:

1. **`/api/healthz` before and after.** Compare the `subsystems` block entry by entry. A
   fresh revision resets in-process counters (RPC quota cooldowns, uptime), so expect those
   to move; what must not move is a subsystem going from `ok` to `degraded` or `down`.
2. **A real signing path.** For the master wallet that is the treasury sweep: a row in
   `economy_master_ledger` timestamped after the new revision's `creationTimestamp`, carrying
   the master's pubkey, proves the container read the secret, decoded 64 bytes, and derived
   the right wallet. On 2026-09-02 revision `three-ws-api-00405-z6c` was created at
   `19:15:17Z` and the ledger kept writing through `19:25:23Z` under
   `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`.

If a migration does regress the service, roll traffic back first and diagnose after:

```sh
gcloud run services update-traffic three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --to-revisions <prior revision>=100
```

## The other ciphertext under this key: connected homes (2026-09-03)

Everything above is about custodial wallet secrets. Since 2026-09-03 the same
`WALLET_ENCRYPTION_KEY` also seals a second, unrelated class of secret:
`home_connections.access_token_enc`, the Home Assistant long-lived access token a user
hands over when they connect their house (`api/_lib/home/store.js`). A rotation covers
both or it covers neither.

The two failures look nothing alike, so do not reason about one from the other:

| | Custodial wallet secret | Home access token |
|---|---|---|
| What a lost key costs | custody, permanently. The SOL is visible on chain and can never be signed for again | reach, temporarily. Nothing is destroyed |
| How the user recovers | they cannot | they paste a fresh long-lived token and reconnect |
| How you notice | a funded wallet fails to sign, and `stranded_custody` counts it | every connected home goes dark at once, with nothing on chain to notice it by |
| What it is a key to | money | a physical building |

The last row is the reason it gets this primitive at all: a home token unlocks a front
door, so it is stored like a wallet key from its first write, never as a hash (we have to
replay it on every socket open) and never in plaintext.

Because a sealed home has no balance to show up in a treasury sweep, it needs its own
reading. Run it alongside the wallet audit at step 3 of the rotation above:

```sh
node scripts/audit-home-credential-health.mjs
```

It is read-only, decrypts in memory only, never prints a token, and carries the same
no-key guard the wallet audit learned: with no decryption key configured it exits 3 rather
than reporting every home as sealed. Exit 1 means something really is sealed. If EVERY
home fails to decrypt, that is one wrong key for the deployment, not a fleet of separately
broken houses: put the outgoing key in `WALLET_ENCRYPTION_KEY_PREVIOUS` before telling
anybody to reconnect.

## Dedicated-key re-seal: inventory, dry-run counts and runbook (2026-11-04)

Production's `WALLET_ENCRYPTION_KEY` (Secret Manager `wallet-encryption-key`, one version)
and `JWT_SECRET` (`jwt-secret`) hold the same value: `node scripts/audit-custodial-key-health.mjs --keys-only`
exits 4 (fingerprint `245209ce`). A session-secret leak therefore opens every custodial
wallet, and rotating `JWT_SECRET` to kill sessions would brick them. The fix is a verified
re-seal of every sealed value under a new key, then the key swap. The tool is
`scripts/reseal-custodial-wallets.mjs`; its tests are `tests/reseal-custodial-wallets.test.js`
(synthetic keys, real in-process Postgres) and the rotation-ordering cases in
`tests/secret-box.test.js`.

### Sealed-column inventory

Every `encryptSecret` call site in `api/` and what it writes (`grep -rn "encryptSecret(" api workers`).
The re-seal script's `TARGETS` list covers every SQL column in this table; `address` is the
stored public address the decrypted secret must derive before a row is rewritten.

| Table.column | Holds | Address check |
|---|---|---|
| `agent_identities.meta.encrypted_solana_secret` | agent custodial Solana key | `meta.solana_address` |
| `agent_identities.meta.encrypted_wallet_key` | agent custodial EVM key | `wallet_address` |
| `agent_identities.meta.hyperliquid.api_wallet.encrypted` | Hyperliquid API wallet key | `...api_wallet.address` |
| `master_wallets.encrypted_solana_secret` / `encrypted_evm_key` | per-user master wallet | `solana_address` / `evm_address` |
| `x402_ring_pool.encrypted_secret` | x402 ring pool wallets | `pubkey` |
| `x402_fresh_wallets.encrypted_secret` | per-job fresh x402 wallets | `pubkey` |
| `agent_vaults.encrypted_secret` | vault trading wallet | `vault_address` |
| `irl_drops.escrow_secret_enc` | money-drop escrow wallet | `escrow_address` |
| `agent_signers.session_secret_enc` | self-custody session delegate | `session_pubkey` |
| `pump_funded_launch_intents.mint_secret` | new coin mint keypair | `mint` |
| `agent_cards.secret_enc` | virtual card secret | none (opaque JSON) |
| `agent_mcp_connections.credentials_enc` | MCP connection credentials | none |
| `home_satellites.viewer_secret_enc` | home satellite viewer secret | none |
| `home_connections.access_token_enc` | Home Assistant token | none |
| `vanity_inventory.secret_ciphertext` (`aes-256-gcm` rows) | vanity grind keypairs | none (keypair or mnemonic) |

Sealed outside SQL columns, so not in the script, with the reason each is safe to leave:
`api/vanity/drops.js` `encryptedAtRest` and `api/bnb/vault-upload.js` `contentKeyCiphertext`
live in the TTL'd drop and key caches (they expire; both still open through `_PREVIOUS`
during the 30-day window). `api/_lib/health-probes.js` seals a throwaway canary. Rows with
`secret_scheme = 'gcp-kms+aes-256-gcm'` are KMS envelopes and are not secret-box values.

### Dry-run counts against production (read-only, 2026-11-04)

`node scripts/reseal-custodial-wallets.mjs` with the live `DATABASE_URL`, `WALLET_ENCRYPTION_KEY`
and `JWT_SECRET` (nothing written, no new key supplied):

| Target | Rows | Resealable | Undecryptable | Address mismatch |
|---|---:|---:|---:|---:|
| `agent_identities.meta.encrypted_solana_secret` | 1113 | 1089 | 24 | 0 |
| `agent_identities.meta.encrypted_wallet_key` | 591 | 562 | 21 | 8 |
| `master_wallets.encrypted_solana_secret` | 3 | 3 | 0 | 0 |
| `master_wallets.encrypted_evm_key` | 3 | 3 | 0 | 0 |
| `x402_ring_pool.encrypted_secret` | 2000 | 2000 | 0 | 0 |
| `x402_fresh_wallets.encrypted_secret` | 4813 | 4813 | 0 | 0 |
| `home_connections.access_token_enc` | 42 | 7 | 35 | 0 |
| `home_satellites.viewer_secret_enc` | 2 | 0 | 2 | 0 |
| `vanity_inventory.secret_ciphertext` | 2 | 0 | 2 | 0 |
| every other target | 0 | 0 | 0 | 0 |

**Re-measured 2026-11-14** (same command, still read-only): keys still match
(`--keys-only` exits 4, fingerprint `245209ce`). Undecryptable and mismatch figures are
unchanged (24, 21, 0, 2, 35, 2 stuck; 8 mismatched); only new wallets grew the resealable
counts: `encrypted_solana_secret` 1181 rows (1157 resealable), `encrypted_wallet_key` 620
(591), `x402_fresh_wallets` 10953 (10953). No new row became stranded.

How to read it:

- **Undecryptable** rows are the already-known sealed set (24 Solana wallets sealed by
  deployments that carried their own key, see the top of this file and `stranded-wallets.md`),
  plus the same agents' EVM keys and 39 home and vanity rows written by non-production
  deployments against the shared database. The script never touches them. Every key they
  need that we hold is already tried; `scripts/recover-sealed-wallets.mjs` is still the way
  to bring one back if its key surfaces.
- **8 address mismatches** are agents whose stored `wallet_address` is not the address of
  their custodial EVM key (the column was reused for another address after creation; checked
  on one: created 2026-04-30, stored and derived addresses differ). The secret opens fine, so
  nothing is lost, but the script refuses to rewrite a row it cannot prove. `--apply` aborts on
  the first one; pass `--hold-mismatched` to leave exactly those rows under the old key (they
  stay readable through `WALLET_ENCRYPTION_KEY_PREVIOUS`) and reseal everything else.

### Runbook (owner-gated: steps 3 to 6 change production)

All values go through files in the gitignored `.deploy/` at mode 600 and shell variables.
Never paste a key into argv, a ticket or chat; the scripts print fingerprints and counts only.

1. **Measure.** Export the live values and confirm the starting state:
   ```sh
   export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
   export WALLET_ENCRYPTION_KEY="$(node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw)"
   export JWT_SECRET="$(node scripts/read-service-env.mjs '^JWT_SECRET$' --raw)"
   node scripts/audit-custodial-key-health.mjs --keys-only      # exit 4 while they match
   node scripts/reseal-custodial-wallets.mjs                    # dry run, compare with the table above
   ```
2. **Generate the new key offline** and keep a copy of the old one:
   ```sh
   umask 077; mkdir -p .deploy
   openssl rand -base64 48 | tr -d '\n' > .deploy/wallet-key-new
   printf %s "$WALLET_ENCRYPTION_KEY" > .deploy/wallet-key-old
   export RESEAL_NEW_KEY="$(cat .deploy/wallet-key-new)"
   RESEAL_NEW_KEY="$RESEAL_NEW_KEY" node scripts/reseal-custodial-wallets.mjs   # dry run with the new key, same counts expected
   ```
3. **Let the services read both keys first** (no data changes yet). The old key becomes
   `_PREVIOUS`, the new key becomes current. `agent-sniper` carries the key too:
   ```sh
   gcloud secrets create wallet-encryption-key-previous --project aerial-vehicle-466722-p5 --data-file=.deploy/wallet-key-old
   gcloud secrets versions add wallet-encryption-key --project aerial-vehicle-466722-p5 --data-file=.deploy/wallet-key-new
   for svc in three-ws-api agent-sniper; do
     gcloud run services update $svc --region us-central1 --project aerial-vehicle-466722-p5 \
       --update-secrets WALLET_ENCRYPTION_KEY=wallet-encryption-key:latest,WALLET_ENCRYPTION_KEY_PREVIOUS=wallet-encryption-key-previous:latest
   done
   ```
   Use `--update-secrets` or `--update-env-vars`, never `--set-env-vars` (it replaces the whole set).
   The write-key guard moves the database fingerprint forward because the outgoing key is
   listed in `_PREVIOUS`. Check `/api/healthz` and run the audit with the new current key:
   the undecryptable count must equal the dry-run figure.
4. **Re-seal.** With the OLD values in the shell (step 1) and `RESEAL_NEW_KEY` set:
   ```sh
   node scripts/reseal-custodial-wallets.mjs --apply --hold-mismatched
   node scripts/reseal-custodial-wallets.mjs                    # rerun: every target now `current`, nothing resealable
   ```
   The run is batched (`--batch-size`, default 100), writes the new ciphertext and a backup
   row (`custodial_reseal_backup`: old and new ciphertext) in one atomic batch, re-reads the
   stored value and re-derives the address after each batch, and is resumable: if it dies,
   run the same command again, rows already under the new key are skipped.
5. **Verify.** Re-run the audit with the new key as current and the old one in `_PREVIOUS`
   (`node scripts/audit-custodial-key-health.mjs`): undecryptable count unchanged from the dry run,
   `--keys-only` still exits 4 only because `JWT_SECRET` still equals the old key; that is next.
6. **Retire the old key after 30 days.** Leave `WALLET_ENCRYPTION_KEY_PREVIOUS` set for 30
   days. Then rotate `JWT_SECRET` to a fresh value (this signs every user out once) and delete
   `WALLET_ENCRYPTION_KEY_PREVIOUS` with `gcloud run services update ... --remove-secrets WALLET_ENCRYPTION_KEY_PREVIOUS`.
   Until `JWT_SECRET` changes it is still an accepted decrypt candidate for old-key records.
   `node scripts/audit-custodial-key-health.mjs --keys-only` must exit 0 afterwards, and
   `scripts/recover-sealed-wallets.mjs --list` should show only the known sealed set.

**Rollback.** Before step 6 nothing is irreversible. Either (a) keep going forward: rows under
the new key stay readable as long as the new key is current or in `_PREVIOUS`; or (b) restore
the old ciphertexts with `node scripts/reseal-custodial-wallets.mjs --rollback --apply`
(compare-and-swap: a row someone changed since is left alone and counted as skipped), then put
the old key back as current (`gcloud run services update ... --update-secrets WALLET_ENCRYPTION_KEY=wallet-encryption-key:1`)
and the new key in `WALLET_ENCRYPTION_KEY_PREVIOUS`. The backup table is kept until step 6.

### X402_SEED_SOLANA_SECRET_BASE58 shares a value with LAUNCHER_MASTER_SECRET_KEY_B64

`scripts/wire-master-wallet.mjs` assigns the two slots to different wallets; production gave
them separate secrets (`x402-seed-solana-secret-base58`, `wallet-coin-launcher-master-b64`)
holding the same wallet. To give the seed slot its own wallet, if the owner wants that
corrected: generate a keypair, fund it for the seed spender's float, then
`printf %s "<base58 secret>" | gcloud secrets versions add x402-seed-solana-secret-base58 --data-file=-`
and roll a new revision. The launcher secret is untouched. Moving funds out of the old shared
wallet is a separate owner-approved transfer.

## Takeaways

- **A key rotation must carry the old key forward, or accompany a sweep.** This is now
  mechanized: set `WALLET_ENCRYPTION_KEY_PREVIOUS` before rotating (see the section above).
  Archiving the retiring key durably is still worth doing, but forgetting it no longer
  destroys custody on its own.
- **Fail closed beats fail silent.** The guard added here refuses to re-key a wallet it
  can't prove is empty. That property should hold for any future self-heal that touches
  custodial secrets.
- Launcher stayed paused (`launcher_config.mode = 'off'`) for the full diagnosis so nothing
  new could get stranded while the key search was underway.

## Related

- [Autonomous economy](../autonomous-economy.md) — the funding-root → engine loop this
  pool feeds.
- `api/_lib/agent-pumpfun.js` — the self-heal + fund-safety guard.
- `scripts/rekey-stale-launch-wallets.mjs` — the batch re-key tool.
- `scripts/audit-home-credential-health.mjs`: the same reading for connected homes, whose
  tokens sit under the same key (see the section above). Exits 3 with no key, 1 when a
  home is sealed.
- [Stranded custodial wallets](stranded-wallets.md): the standing owner decision, and
  the corrected cause of the sealing.
- `scripts/recover-sealed-wallets.mjs`: re-encrypt a sealed wallet in place once its
  original key is found.
- `scripts/reseal-custodial-wallets.mjs`: verified, resumable re-seal of every sealed column under a new key.
- `scripts/audit-custodial-key-health.mjs`: read-only sweep of every custodial wallet,
  how many still decrypt, how much SOL sits behind the ones that do not, and which
  addresses they are. Needs `DATABASE_URL` and `WALLET_ENCRYPTION_KEY`; it exits 3 rather
  than reporting a stranded total when no decryption key is configured.
