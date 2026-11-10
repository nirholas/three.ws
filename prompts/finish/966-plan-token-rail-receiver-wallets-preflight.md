# $THREE receiver wallets preflight, signer-conflict guard and one-command wiring

**Status (2026-11-04):** Tasks 1 to 5 shipped: `assertRewardsNotSwept` guard in all six lane entry points, `three_token_rail` conflict signature, `npm run token:preflight`, money-map rollout section. Remaining, owner only: name the treasury and rewards addresses, then run the one command `npm run token:preflight -- --treasury <t> --rewards <r>` prints (config-only `gcloud run services update --update-env-vars`).

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/966-plan-token-rail-receiver-wallets-preflight.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 92 of 100 inside the tier). **Area:** token. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Production has no `THREE_TREASURY_WALLET` and no `THREE_REWARDS_WALLET` on the `three-ws-api` Cloud Run service. Both fail closed, so `POST /api/token/quote` answers `503 treasury_unavailable` and no $THREE-priced purchase can be priced (Forge paid tiers, paid spins, scarcity mints, token marketplace sales, copy-trading fees). `/api/healthz` already reports `three_token_rail` down. Only the owner can name the two addresses. Everything else is agent work: a preflight that proves candidate addresses are safe, a guard for the documented hazard that the rewards candidate is also the buyback signer (arming the buyback or micro-buy lane would then sweep the whole rewards pool into the treasury), and a single reviewed command that applies the env vars the moment the owner says yes.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5` shows no `THREE_TREASURY_WALLET` and no `THREE_REWARDS_WALLET`. `THREE_QUOTE_SECRET` is wired as a Secret Manager reference.
- `api/_lib/token/config.js`: `treasuryWallet()` and `rewardsWallet()` throw a 503-mapped error in production when unset; `treasuryWalletOrNull()` and `rewardsWalletOrNull()` return null.
- `api/_lib/ops/subsystem-health.js` `checkThreeTokenRail()` reports the missing names and a hint, but does not detect a conflict between the rewards wallet and the buyback or micro-buy signer.
- `api/_lib/token/buyback.js` `executeBuyback()` sweeps bought and stranded $THREE from the signer into the treasury whenever `treasury !== signer`. `api/_lib/token/microbuy.js` and `api/cron/three-buy-loop.js` share the signer. If the signer is the rewards wallet, the rewards pool is swept.
- Candidates documented in `docs/money-map.md`: treasury `wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU` (x402 receiver), rewards `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` (economy master, also the `REWARDS_DISTRIBUTOR_SECRET` signer).
- Tests that exist: `tests/three-token-fee-flow.test.js`, `tests/run-three-buyback-lease.test.js`. No test covers a rewards/signer conflict.
- No `scripts/` preflight for the receivers exists (`ls scripts | grep -i token` finds none for this).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -E "THREE_(TREASURY|REWARDS|QUOTE|BUYBACK|MICROBUY)"
curl -s https://three.ws/api/healthz | grep -o '"three_token_rail"[^}]*' | head -3
grep -n "rewards" api/_lib/token/buyback.js api/_lib/token/microbuy.js api/_lib/solana-signers.js | head
git log --oneline -5 -- api/_lib/token/config.js api/_lib/ops/subsystem-health.js
```

If both wallet vars are already set and healthz reports `ok`, skip task 4 and only complete any of tasks 1 to 3 that are missing.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. In `tests/three-token-fee-flow.test.js` (or a new `tests/token-rail-signer-conflict.test.js`) add a failing test: with `THREE_REWARDS_WALLET` equal to the public key of the configured buyback signer and `THREE_BUYBACK_ENABLED=1`, `planBuyback`/`executeBuyback` must refuse with a typed reason `rewards_wallet_is_signer` and must not build a sweep instruction. Run it and confirm it fails because no guard exists. Add the same case for `api/_lib/token/microbuy.js`.
2. Implement the guard in `api/_lib/token/config.js` as `assertRewardsNotSwept(signerPubkey)` and call it from `buyback.js` (both the buy-then-sweep and the stranded-token self-heal path) and `microbuy.js`. Fail before any RPC spend. Re-run the tests green.
3. Extend `checkThreeTokenRail()` in `api/_lib/ops/subsystem-health.js` to report `status: 'down'` or `'degraded'` with `conflict: 'rewards_wallet_is_signer'` when a buyback lane is enabled and the signer equals the rewards wallet. Add a test in the existing ops-health test file (find it with `ls tests | grep -i health`).
4. Write `scripts/preflight-three-token-rail.mjs`: takes `--treasury` and `--rewards`, validates base58 and that neither is the system program or a PDA that cannot receive, reads mainnet via the configured Solana RPC (read-only) to confirm each is an ordinary system-owned account and shows the existing $THREE token account state, flags the signer conflict by importing the registry in `api/_lib/solana-signers.js`, and prints the exact `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars THREE_TREASURY_WALLET=...,THREE_REWARDS_WALLET=...` command (never `--set-env-vars`). Read-only: it must not sign or send anything. Add `npm run token:preflight` in `package.json` and a test covering the pure validator functions.
5. Add a short "Receiver rollout" section to `docs/money-map.md` with the preflight command, the post-apply verification (`/api/healthz` `three_token_rail` ok, signed-in `POST /api/token/quote` returns a quote with the two destinations), and the buyback decision (separate the buyback signer from the rewards wallet before arming either lane).
6. Do not apply the env vars. Stop at the gate below.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The new guard test fails before the fix and passes after: `node --test tests/token-rail-signer-conflict.test.js` (or the file you extended) exits 0.
- [ ] `npm run token:preflight -- --treasury wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU --rewards WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` runs read-only and prints the apply command and any conflict warning.
- [ ] `checkThreeTokenRail()` surfaces the conflict case in a test.
- [ ] `docs/money-map.md` contains the rollout section.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Owner has not named the wallets | Build and test everything with the documented candidates as inputs, stop at the gate, and put the single apply command in the final report |
| RPC unavailable for the preflight | Use the configured `SOLANA_RPC_URL` from the Cloud Run env; fall back to the public mainnet endpoint for read-only account lookups |
| Unsure whether the signer equals the rewards wallet | Derive the public key from the signer registry in `api/_lib/solana-signers.js` in the preflight and compare programmatically |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Applying `THREE_TREASURY_WALLET` and `THREE_REWARDS_WALLET` to the production service decides where every buyer's $THREE lands. The owner must name both addresses (CLAUDE.md gate: spend routing). This order prepares the command and stops. The config-only `--update-env-vars` call is pre-approved once the owner confirms the addresses. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/966-plan-token-rail-receiver-wallets-preflight.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `966-plan-token-rail-receiver-wallets-preflight.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/money-map.md` (section "$THREE split receivers (inbound $THREE)")
- `prompts/finish/_context/production-100-OWNER-ACTIONS.md`
- `docs/money-map.md` (section "Monitoring coverage")
