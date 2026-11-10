# Custodial wallet encryption key becomes truly dedicated via a verified, reversible re-seal

**Status (2026-11-04):** DONE-PENDING-OWNER. Built and committed in `ca8d16f8f`: `scripts/reseal-custodial-wallets.mjs` (dry run default, address-derivation check, atomic backup plus compare-and-swap, resumable, `--rollback`), `keySeparation` and `sealWithKey`/`openWithKeys` in `api/_lib/secret-box.js`, `--keys-only` audit exit 4, triage finding, inventory, live dry-run counts and the ordered runbook in `docs/ops/wallet-key-migration.md`. 26 tests pass. Remaining, owner-gated: run runbook steps 2 to 4 (new key into Secret Manager for `three-ws-api` and `agent-sniper`, then `RESEAL_NEW_KEY=... node scripts/reseal-custodial-wallets.mjs --apply --hold-mismatched`).

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

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/ops/wallet-key-migration.md`
- `docs/ops/stranded-wallets.md`
- `docs/ops/economy-wallet-rotation.md`
