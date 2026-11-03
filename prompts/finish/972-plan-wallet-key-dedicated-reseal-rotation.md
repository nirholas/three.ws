# Custodial wallet encryption key becomes truly dedicated via a verified, reversible re-seal

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/972-plan-wallet-key-dedicated-reseal-rotation.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 58 of 100 inside the tier). **Area:** wallet. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

On production `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` hold the same value. The guard in `api/_lib/secret-box.js` requires a dedicated key and refuses the `JWT_SECRET` fallback, but a variable set to the same string passes the guard while defeating its purpose: anyone who can mint or learn a JWT signing secret holds the key that unseals every custodial Solana wallet. Separately `X402_SEED_SOLANA_SECRET_BASE58` equals `LAUNCHER_MASTER_SECRET_KEY_B64` although the wiring script assigns them to different wallets. Rotation was deliberately left undone because a careless re-key strands wallets (this already happened once, see stranded-wallets.md). The tooling to do it safely does not exist: there is a recover script and an audit script but no verified re-seal.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/secret-box.js` supports `WALLET_ENCRYPTION_KEY`, `WALLET_ENCRYPTION_KEY_PREVIOUS` (comma-separated retired keys) and a fingerprint binding `verifyWriteKey` stored in `app_settings` key `secret_box_write_key`. Decrypt tries current, then previous, then `JWT_SECRET`.
- Scripts that exist: `scripts/recover-sealed-wallets.mjs` (tries candidate keys, `--apply`), `scripts/audit-custodial-key-health.mjs`, `scripts/read-service-env.mjs`, `scripts/migrate-plaintext-secrets.mjs`. Test: `tests/secret-box.test.js`.
- No script re-encrypts all sealed rows under a new key with before/after verification.
- The doc `docs/ops/wallet-key-migration.md` states both duplicate-value findings as "NOT fixed, needs an owner decision".

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
node --env-file=.env scripts/audit-custodial-key-health.mjs 2>&1 | tail -30
grep -n "WALLET_ENCRYPTION_KEY_PREVIOUS\|verifyWriteKey\|secret_box_write_key" api/_lib/secret-box.js | head
ls scripts | grep -iE "reseal|rekey|rotate"
node scripts/read-service-env.mjs --help 2>&1 | head -20
```

Compare fingerprints (never print values) of `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` on the live service using the audit script's fingerprint output.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Inventory every table and column sealed by `secret-box` (`grep -rn "sealSecret\|secretBox\|encryptSecret\|unseal" api workers scripts`): custodial agent wallets, launcher wallets, sniper wallets, any user key material. Write the inventory into `docs/ops/wallet-key-migration.md`.
2. Write `scripts/reseal-custodial-wallets.mjs`: read old key set and new key from env (never argv), per row decrypt with the old set, re-encrypt with the new key, write ciphertext to a new `*_resealed` shadow value or a backup table in the same transaction, decrypt the new ciphertext again and compare the plaintext public key derivation (derive the Solana address from the secret and assert it equals the stored address) before committing. Default is dry run with a report: counts per table, rows that fail to decrypt (reported, never modified), and zero secret material in output. `--apply` processes in batches with resume support.
3. Test first in `tests/reseal-custodial-wallets.test.js` using synthetic keys and an in-memory or test database: round trip, row that cannot decrypt is left untouched, interrupted run resumes, address-derivation mismatch aborts the batch, output never contains secret bytes. Add the cases to `tests/secret-box.test.js` for `_PREVIOUS` rotation ordering.
4. Run the dry run against production data with read-only credentials (`DATABASE_URL` via `scripts/read-service-env.mjs`) and record the counts. Confirm zero undecryptable rows beyond the already-known stranded set.
5. Prepare the runbook section: generate the new key offline, `gcloud secrets versions add`, set `WALLET_ENCRYPTION_KEY=<new>` and `WALLET_ENCRYPTION_KEY_PREVIOUS=<old>` with `gcloud run services update --update-env-vars` (never `--set-env-vars`), run `--apply`, re-run the audit, leave the old key in `_PREVIOUS` for 30 days, then retire it. Also document the one-line change that gives `X402_SEED_SOLANA_SECRET_BASE58` its own wallet if the owner wants that corrected.
6. Add a `check` to `scripts/audit-custodial-key-health.mjs` that fails when `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` fingerprints match, and wire it into the production sweep documented in `docs/ops/gcp-production.md`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm test -- tests/reseal-custodial-wallets.test.js tests/secret-box.test.js` pass.
- [ ] `node --env-file=.env scripts/reseal-custodial-wallets.mjs` (dry run) prints per-table counts with `undecryptable` equal to the known stranded count and exits 0.
- [ ] The audit script exits non-zero while the two keys still match and zero after rotation.
- [ ] The runbook in `docs/ops/wallet-key-migration.md` lists every command, in order, with the rollback (restore the old key as current).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No production DB credentials locally | `node scripts/read-service-env.mjs` pulls them from the Cloud Run service; use a read-only dry run. |
| A row will not decrypt | Report it and leave it untouched; the re-seal skips it. Use `scripts/recover-sealed-wallets.mjs` candidate-key search only against copies. |
| Temptation to print a key to debug | Print fingerprints only (first 8 hex of SHA-256). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The `--apply` run against production data and the production key change rewrite stored ciphertext for real user wallets. Everything up to the verified dry run, the tests and the runbook is done by the agent. The apply and the secret swap are batched into a single owner confirmation at the end of the session (CLAUDE.md gate 4, destroying data that cannot be regenerated, mitigated by the retained `_PREVIOUS` key and backup values).

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/972-plan-wallet-key-dedicated-reseal-rotation.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `972-plan-wallet-key-dedicated-reseal-rotation.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ops/wallet-key-migration.md` (whole file)

~~~~markdown
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
the `JWT_SECRET` fallback) were both already active - so those 12 wallets were sealed under
a dedicated key that existed only in the pre-migration Vercel runtime.

The 2026-07-07 Vercel → Cloud Run migration did not carry that key forward. Cloud Run's
Secret Manager `WALLET_ENCRYPTION_KEY` has only one version, created on the migration date
itself - a newly generated key, not the one the pool wallets were encrypted under. Every
autonomous launch attempt against those 12 wallets failed with a definitive AES-GCM
`OperationError` (auth-tag mismatch - proof of a wrong key, not a transient fault).

## Recovery attempt

Searched every place the pre-migration key could plausibly still exist:

- GCP Secret Manager - `WALLET_ENCRYPTION_KEY` and `JWT_SECRET`, all versions: only the
  2026-07-07 (post-migration) version exists for either.
- Vercel env (CLI export) - `WALLET_ENCRYPTION_KEY` was not present at all (never set, or
  deleted); `JWT_SECRET` was present but exported empty.
- Owner-supplied candidates (current deploy key, one manually recalled value) - both tried
  against the stranded wallets' ciphertext; neither decrypted.
- Prior scratch/staging notes from the migration itself - only the current key.

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

Total stranded across the 12 pool wallets: **1.41 SOL**, confirmed unrecoverable - no valid
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

- `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` hold the **same value** on production. The
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

- [Autonomous economy](../autonomous-economy.md) - the funding-root → engine loop this
  pool feeds.
- `api/_lib/agent-pumpfun.js` - the self-heal + fund-safety guard.
- `scripts/rekey-stale-launch-wallets.mjs` - the batch re-key tool.
- `scripts/audit-home-credential-health.mjs`: the same reading for connected homes, whose
  tokens sit under the same key (see the section above). Exits 3 with no key, 1 when a
  home is sealed.
- [Stranded custodial wallets](stranded-wallets.md): the standing owner decision, and
  the corrected cause of the sealing.
- `scripts/recover-sealed-wallets.mjs`: re-encrypt a sealed wallet in place once its
  original key is found.
- `scripts/audit-custodial-key-health.mjs`: read-only sweep of every custodial wallet,
  how many still decrypt, how much SOL sits behind the ones that do not, and which
  addresses they are. Needs `DATABASE_URL` and `WALLET_ENCRYPTION_KEY`; it exits 3 rather
  than reporting a stranded total when no decryption key is configured.
~~~~

### `docs/ops/stranded-wallets.md` (whole file)

~~~~markdown
# Stranded custodial wallets: the standing owner decision

Some custodial Solana wallets on three.ws are sealed under an encryption key
production does not hold. Their balance is visible on chain and keeps rendering in
the product, but cannot be signed for until the sealing key is found. Two of those
wallets belong to customers who cannot withdraw; one also holds 99.94637 USDC.

This is the decision brief. It carries the measurement, the recovery path, what each
option costs if recovery fails, and the exact commands for whichever option
the owner picks. It does not move money: crediting, contacting, or writing off a
customer balance is the owner's call.

The incident that created them is recorded in
[wallet-key-migration.md](wallet-key-migration.md). This file is the standing
decision that incident left open.

## What happened

**Corrected 2026-09-16.** This brief used to say the 2026-07 Vercel to Cloud Run
migration rotated `WALLET_ENCRYPTION_KEY` and lost the old value. The measurement
says otherwise:

- Every wallet the production API wrote in June 2026, including a "My First Agent"
  created the same day as the stranded customer wallet, opens with **today's**
  production key. Production's key never changed.
- The stranded customer wallet failed its first withdrawal on 2026-06-30, a week
  **before** the migration, while production held that same key.
- Wallets kept being sealed after the migration: 13 QA agents on 2026-08-16 (headless
  Chrome) and one on 2026-09-03 (a session whose user agent was `home15-preview`).
- Every `three-ws-api` Cloud Run revision since 2026-07-07, `agent-sniper`, and the
  `wallet-encryption-key` / `agent-orders-*` secrets carry one key value, the current
  one. None of them opens a sealed wallet.

The real cause: **a deployment that shared the production database but carried its
own key** wrote those wallets. `secret-box.js` only requires the dedicated key when
`VERCEL_ENV` or `NODE_ENV` is `production`, so a preview or dev server pointed at
production silently encrypted under whatever `WALLET_ENCRYPTION_KEY` or `JWT_SECRET`
it had. In June that was a Vercel-era deployment other than production (a preview
environment or a second Vercel project on the same database); in August and
September, dev and preview servers.

That changes the recovery question. The keys were never in Google Cloud, so
searching it again finds nothing. They may still exist where those deployments
kept their env: **the Vercel dashboard** (every project and every environment that
had this `DATABASE_URL`, Settings > Environment Variables; non-sensitive values are
viewable there) and any local `.env` a developer ran against production. A database
backup does not help on its own: it holds the same ciphertext, never the key.

### It cannot happen again

`encryptSecret` now binds a database to the key that writes into it
(`verifyWriteKey` in `api/_lib/secret-box.js`). The first write records an HMAC
fingerprint of the key in `app_settings` under `secret_box_write_key`; any later
process holding a different key is refused with `secret_box_key_mismatch` before it
can seal anything. A runbook rotation (outgoing key kept in
`WALLET_ENCRYPTION_KEY_PREVIOUS`) moves the binding forward instead of refusing.
Production was bound on 2026-09-16 with
`node scripts/recover-sealed-wallets.mjs --bind`.

## Recovering a sealed wallet (no funds move)

`scripts/recover-sealed-wallets.mjs` opens a sealed secret with a candidate key,
proves it signs for the stored address, and re-encrypts it under the production key
with a compare-and-swap on the old ciphertext. The address never changes, so the
owner's balance simply becomes withdrawable. Candidate keys go in on stdin, one per
line, and are never printed.

```bash
export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
export WALLET_ENCRYPTION_KEY="$(node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw)"
node scripts/recover-sealed-wallets.mjs --list                  # the sealed set
node scripts/recover-sealed-wallets.mjs < candidate-keys.txt    # dry run: which key opens which wallet
node scripts/recover-sealed-wallets.mjs --apply < candidate-keys.txt
```

Try the `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` of every Vercel project and
environment that pointed at this database. Delete the candidate file afterwards.

### The funded customer wallet is a real customer

Checked on chain 2026-09-16 for `GemVS5fT958FKRe5fpgizohUYUKE8cUDueEdmB1bmXnm`
(agent `5e05f68f-eead-4ef9-b6b4-fc85ea73bbe9`): 10 + 89.94527 USDC and 0.25 SOL
arrived on 2026-06-27 from `58uQ7w8qPvDcD4WsUqtZqCkiMyJrz1fEeMZmuRPaPbZv`. Minutes
later a look-alike address (`58uQT1Y1…PbZv`) and `5811kC…5bZv` sent dust: that is
address poisoning aimed at the customer. The account was created from Phantom's iOS
in-app browser, and every withdrawal asked for either the genuine funding wallet or
the owner's own login wallet `7jWU2UBX7nKEFSXndbjR3NoSmgeqhL6Fh9fA1Vd7GaRe`, never
the poisoned address. Nothing indicates abuse.

## Measured state

Re-derive before acting. On a machine with the production key:

```bash
node scripts/audit-custodial-key-health.mjs            # human table
node scripts/audit-custodial-key-health.mjs --json     # same numbers, machine readable
```

The script exits 3 without touching the database when no decryption key is
configured, because a keyless run can only report 100% undecryptable and says
nothing about production. The same measurement is served continuously at
`GET /api/ops/payment-outcomes` under `stranded_custody` (see
[payment-outcomes.md](payment-outcomes.md)), so an operator without the key can
still read the current count from the running service.

### Platform wallets (measured 2026-09-02, live)

These two are confirmed sealed by production itself: the treasury-topup reclaim
leg has attempted them on every run and recorded `secret_undecryptable` in
`economy_master_ledger` 35,736 and 35,739 times respectively, most recently
2026-09-02.

| Agent | Agent id | Address | SOL on chain | Owner |
|---|---|---|---|---|
| Atlas #22 | `00bf4380-a6dd-4693-80d3-52bf23a8855b` | `6FL9viFy2WrYMWPd3HAQA4Bxm5qxQWoQMn3T9GbcwxEB` | 0.078390963 | `ashaatlas2@agents.three.ws` (platform bot) |
| Echo #22 | `73da6b13-223a-481e-ab4c-4c293a462d62` | `8u5raEaz7Qjm5hRzNxwzXiZtjTkdgQ3Co6G6S5WNxFTs` | 0.064484542 | `zaneecho4@agents.three.ws` (platform bot) |

Platform total: **0.142875505 SOL**. This is the number the treasury dry run used
to advertise as reclaimable; it no longer does (see "What was already fixed").

### Customer wallets (support obligation)

The last keyed audit (2026-08-09, recorded in
[wallet-key-migration.md](wallet-key-migration.md)) measured **8 sealed wallets
holding 0.49 SOL, of which 0.35 SOL belongs to customers**. One of those customer
agents is confirmed independently by production: it hit the withdraw path and
`agent_custody_events` recorded `wallet_key_retired` against it.

Both funded customer wallets are now named. The keyed audit was run against
production on 2026-09-04 (`node scripts/audit-custodial-key-health.mjs --json`,
read-only, key pulled from Secret Manager and never written to disk), which
resolved the second one this table previously left blank.

| Agent | Agent id | Address | SOL on chain (2026-09-04) | Owner |
|---|---|---|---|---|
| My First Agent | `5e05f68f-eead-4ef9-b6b4-fc85ea73bbe9` | `GemVS5fT958FKRe5fpgizohUYUKE8cUDueEdmB1bmXnm` | 0.250001 | `sol-240f8dec53dc5d72@wallet.local` (wallet-auth customer) |
| Swarm Treasury (test) | `a20829e1-6dd7-4495-9141-8f5d69be86a9` | `HPL1LfuTdYDwtzJDzsnrmR2ngrrQwLTQyxJszCC4DHsN` | 0.100001 | `sol-4ac625e9b4d3ff8e@wallet.local` (wallet-auth customer) |

Customer total: **0.350002 SOL**, across exactly **two** accounts. That is the
whole support obligation: two people, two destinations, one decision.

The 2026-09-04 sweep covered 735 custodial wallets and found 9 undecryptable (up
one from the 8 measured 2026-08-09, because the sealed set grows only when an old
record is newly touched, never because a new wallet is written under a dead key).
Seven of the nine are customer wallets, but five of those hold nothing: only the
two above carry a balance. The platform's own two are unchanged at 0.142875505
SOL. `stranded_unread` is empty, so nothing is unaccounted for.

Re-running the audit needs `WALLET_ENCRYPTION_KEY` from the `three-ws-api`
service (`node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw`).
That is the only step in this brief that needs the key, and it is read-only. The
decision below does not wait on it: the table above is the measurement.

### What the customer sees today

Not a silent lie, as of the 2026-08 fixes: `GET /api/agents/:id/solana-wallet`
attempts a local decrypt on the owner's own read and returns
`signable: false, signable_reason: "key_retired"` beside the balance, and a
withdrawal attempt answers `409 wallet_key_retired` telling the owner that no
funds moved, that retrying will not help, and to contact support before creating a
replacement wallet (provisioning a new one abandons the balance at the old
address). Nobody is being invited to retry forever. Nobody has been made whole
either.

## The options

| Option | What it costs | What it settles |
|---|---|---|
| **1. Credit the customers from treasury** (recommended) | About 0.35 SOL from the economy master, plus the transfer fees. At the SOL price this is a rounding error against the fee wallet's daily burn. | Ends the obligation completely and quietly. The customer is whole, the balance they see becomes real again, and no support conversation is needed. |
| **2. Contact the customers first, then credit** | The same 0.35 SOL plus the support round trip. Both accounts are wallet-auth (`*@wallet.local`), so there is no email address on file: contact means an in-product notice, not a mail. | Same outcome as option 1, slower, and it advertises an internal key incident to a user who may not have noticed. |
| **3. Write the balance off** | Zero SOL. Costs the customer 0.35 SOL of their own money and leaves a permanently unspendable balance rendering in their wallet card. | Nothing. The wallet card keeps showing an amount that cannot move; the obligation stays open indefinitely. |

Recommendation: **option 1**. The amount is trivial against the treasury, it is
our defect rather than the customer's, and the alternative leaves a broken balance
on screen forever. The 2026-07 precedent supports it in spirit: when the same
rotation stranded 12 platform pool wallets holding 1.41 SOL, that money was
written off because it was ours to lose. Customer money is not.

### If the owner picks option 1 (credit)

Crediting is a fund transfer, so it stops at gate 1 in `CLAUDE.md`: recipient,
amount, and chain get rendered and confirmed before anything signs. The wallets
themselves cannot receive a "restore" (they cannot be signed for, so a deposit
into them is a second write-off). Credit the customer's OTHER agent wallet, or a
destination the customer names.

1. Confirm the current stranded set and its owners:
   ```bash
   node scripts/audit-custodial-key-health.mjs --json \
     | jq '{customer_sol: .sol.stranded_customer, wallets: [.top_stranded[] | select(.platform == false)]}'
   ```
2. For each affected user, pick the destination: another custodial agent wallet
   they own, or an address they supply. Never the sealed address.
3. Send from the economy master with the standard confirmation table (recipient,
   amount, token, chain) and the owner's explicit yes, per gate 1.
4. Record it: append the credit to [wallet-key-migration.md](wallet-key-migration.md)
   under the incident's timeline so the ledger and the incident record agree.

### If the owner picks option 3 (write-off)

Nothing needs to run. The wallets stay sealed and the product already tells the
owner they are unsignable. Note the decision in
[wallet-key-migration.md](wallet-key-migration.md) and delete the OWNER-ACTIONS
row so the question stops being re-litigated.

### The platform's own 0.14 SOL, either way

No decision needed: it is already gone, and nothing plans against it any more.
Leave the two bot wallets alone. Do NOT re-key them with
`scripts/rekey-stale-launch-wallets.mjs`: that script refuses a wallet holding
more than 0.01 SOL for a reason (`409 wallet_funds_stranded`), and forcing it
with `--force-drop-funds` abandons the balance at the old address for nothing.

## What was already fixed, so nobody re-diagnoses it

- **The treasury dry run no longer advertises sealed SOL.** `reclaimIdleAgentSol()`
  in `api/_lib/economy-sweepback.js` used to return its plan before ever touching
  a key, so `POST /api/cron/treasury-topup?dry=1` promised about 0.12 SOL that the
  real leg could never move. Two separate sessions read that plan and concluded the
  treasury would self-heal. The dry path now runs the same read-only key recovery
  the real path does: sealed wallets are excluded from `reclaimedSol` and reported
  in `failed` with `stage: "recover"` and a `secret_undecryptable` reason.
  Pinned by `tests/economy-reclaim-dryrun-key-gate.test.js`.
- **The wallet card and the withdraw path tell the truth** (`signable: false`,
  `409 wallet_key_retired`), as described above.
- **The audit refuses to guess.** A wallet whose balance was not read is never
  counted as a confirmed zero, and a keyless run aborts instead of reporting a
  fleet-wide phantom.
- **The number is visible without a CLI run.** `stranded_custody` on
  `/api/ops/payment-outcomes` carries count, SOL, and the platform/customer split,
  snapshot-cached for six hours.

## Preventing the next one

The rotation runbook in [wallet-key-migration.md](wallet-key-migration.md) is the
procedure: set `WALLET_ENCRYPTION_KEY_PREVIOUS` to the outgoing key BEFORE the new
key goes live, keep it there until an audit run reports zero undecryptable
wallets, and only then drop it. A rotation without that overlap is a one-way door,
and this brief is what the far side of one looks like.
~~~~

### `docs/ops/economy-wallet-rotation.md` (whole file)

~~~~markdown
# Economy wallet registry and rotation

Every Solana wallet the platform spends from is defined in
[`api/_lib/solana-signers.js`](../../api/_lib/solana-signers.js): a role name, the
env var holding its secret, what it pays for, and the SOL floor it must keep.
That file answers "what does the economy use right now". It cannot answer "what
did the economy use in July", because rotating a signer overwrites an env var and
the previous address survives nowhere.

`economy_wallet_registry` is the missing half: a durable, append-only log of every
wallet each role has ever held, with the lineage between them. Reconciling an old
settle, attributing a fee, or proving which wallet received a payment last quarter
is now a query instead of an archaeology session on the chain.

**No secret material is ever stored in the registry.** A row records the public
address and *where* the secret lives (an env var name, or the 0600 file a freshly
generated key was written to). Nothing in this flow reads or writes Secret
Manager, and nothing puts a key into production for you: the cutover command is
printed for a human to run, because installing a live signing key is a deliberate
act.

- Schema: [`api/_lib/migrations/20260819010000_economy_wallet_registry.sql`](../../api/_lib/migrations/20260819010000_economy_wallet_registry.sql)
- Operator surface: [`scripts/economy-wallets.mjs`](../../scripts/economy-wallets.mjs) (`npm run economy:wallets`)
- Related: [economy funding root](../economy-master.md), [money map](../money-map.md), [x402 ring economy](../x402-ring-economy.md)

## Commands

```bash
npm run economy:wallets -- list                       # whole registry, newest first per role
npm run economy:wallets -- list --role economy-master # one role's history

# log a wallet that is already live (backfill, or an imported wallet)
npm run economy:wallets -- record --role economy-master --address <pubkey> --status active

# generate a fresh wallet for a role, logged as pending, production untouched
npm run economy:wallets -- new --role economy-master --vanity www

# flip a pending wallet to live AFTER it is funded and its env var is set
npm run economy:wallets -- activate --role economy-master --address <pubkey>

npm run economy:wallets -- retire --role economy-master --address <pubkey>
```

`--vanity` grinds a case-insensitive address prefix (up to 4 characters) so a
rotated wallet keeps the house `www…` look. Three characters takes a few seconds.

A unique partial index enforces **exactly one active wallet per role per
network**, so a half-finished rotation cannot be left behind: `activate` retires
the predecessor in the same step, and a second concurrent activation fails loudly
rather than leaving two wallets both claiming to be live.

## Rotating a role

Order matters. Funding first and env last means the window where production holds
a key to an empty wallet is zero.

1. **Generate.** `npm run economy:wallets -- new --role <role>`. The secret lands
   in `~/.three-ws-wallets/<role>.<pubkey>.env` (mode 0600, outside the repo). The
   address is logged as `pending` with `rotated_from` pointing at the incumbent.
2. **Fund it** to at least the role's `minSol` floor. Below the floor the wallet
   is live but useless: the sponsor stops settling, and an engine stalls.
3. **Sweep the old wallet** if the role carries `holdsTokens` (the x402 ring
   treasury holds the USDC float). Skipping this strands the float at an address
   production no longer reads.
4. **Set the env var**, including every alias for that role (see below), with a
   single `gcloud run services update --update-env-vars`. Never
   `--set-env-vars`: it replaces the entire env set.
5. **Activate** in the registry, then verify with `npm run audit:service-wallets`,
   which derives each pubkey from the secret production actually holds and
   cross-checks it against what the live 402 challenges advertise.

## Roles read through more than one env var

One physical wallet can be read through several vars. Rotating the role means
moving all of them in the same cutover, because a 402 challenge that advertises
one address while the server co-signs with another fails every settle against it.

| Role | Vars that must move together |
| --- | --- |
| `economy-master` | `ECONOMY_MASTER_SECRET_BASE58` (secret), `X402_FEE_PAYER_SOLANA` (advertised fee payer) |
| `pump-x402-launcher` (the x402 ring treasury) | `PUMP_X402_LAUNCHER_SECRET_KEY_B64` (secret), `X402_TREASURY_SECRET_BASE58` (same key, base58), `X402_PAY_TO_SOLANA` (advertised receiver) |

`npm run economy:wallets -- new` prints the alias set for the role it is
generating, so this table is a reference rather than something to remember.

## Why the master is the one to be careful with

The economy master is also the x402 sponsor fee payer. Below
`X402_SPONSOR_SOL_FLOOR_LAMPORTS` the self-facilitator refuses to settle and
`buildRequirements()` withdraws the Solana accept from every 402 challenge, so
Solana-only paid endpoints return `settlement_unavailable` and every other paid
endpoint quietly degrades to Base-only. The outward symptom is not a clean
outage, which is exactly why the runway alert in
[`api/_lib/x402/sponsor-runway.js`](../../api/_lib/x402/sponsor-runway.js) measures
days-to-floor rather than days-to-zero. Rotate the master only with the
replacement already funded above its floor.
~~~~

