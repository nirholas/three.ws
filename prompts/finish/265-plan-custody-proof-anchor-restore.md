# Proof of custody anchors on Solana again: 522 epochs, zero anchored, public integrity page down

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/265-plan-custody-proof-anchor-restore.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 74 of 100 inside the tier). **Area:** custody. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The platform's headline custody promise is "provable, not promised": every six hours the custody cron snapshots all 788 custodial wallets into a Merkle root and is meant to commit that root on Solana as a signed SPL-Memo. Production shows 522 epochs recorded and 0 anchored, every one `anchor_failed`, so the commitment is never timestamped on a public chain, and the public `/integrity` page was taken down (commit `d44332275`) because it would headline "custody you can verify" above a table of failures. The root cause is measurable: the epoch root is anchored on Solana devnet (the `CUSTODY_ANCHOR_NETWORK` default), but the attester wallet is only ever funded on mainnet, and nothing alerts on the custody lane. Marketing and CoinMarketCap drafts already cite the custody proof, so the claim has to become true.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `curl -s https://three.ws/api/custody/integrity` returns `epochs_total: 522`, `epochs_anchored: 0`, latest epoch 522 with `anchor_network: "devnet"`, `anchor_status: "anchor_failed"`, `anchor_sig: null`, created 2026-11-03T00:18Z, `wallet_count: 788`.
- Attester pubkey (from `api/_lib/solana-signers.js`, entry `reasoning-ledger-attester`, env `ATTEST_AGENT_SECRET_KEY`, which is set on Cloud Run): `Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH`. Public RPC `getBalance`: mainnet 24,914,962 lamports (about 0.0249 SOL, above its 0.02 SOL `minSol`), devnet 0 lamports. An unfunded devnet payer makes every memo broadcast fail.
- `api/_lib/custody-proof.js`: `ANCHOR_NETWORK = process.env.CUSTODY_ANCHOR_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'` (line 55) with a comment saying devnet is the cheap default. `anchorRoot` (line 240) marks `anchor_failed` with the raw RPC message (`markAnchorFailed`, `anchor_error` column) and returns; the custody cron `api/cron/custody-attest.js` never alerts. The reasoning-ledger lane, by contrast, has an outage alert (`api/cron/reconcile-decisions.js`, signature `ledger-anchor-broadcast-failed`) and anchors on mainnet by default.
- `pages/integrity.html` still exists but has no route: `curl -sI https://three.ws/integrity` is 404. `d44332275` removed the route from `vercel.json`, the bundle entry and in-product links (`pages/proof.html`, `src/proof.js`, `src/proof-of-custody/ui.js`, `src/agent-wallet-hub/tabs/proof.js`, `docs/custody.md`). `/proof` (per-wallet inclusion proof) is live (200).
- Tests that exist: `tests/custody-proof-epoch.test.js`, `tests/custody-merkle.test.js`, `tests/custody-public-endpoints.test.js`, `tests/cron-ledger-anchor-outage.test.js`, `tests/solana-signers-attester.test.js`.
- `docs/custody.md` "Honest limits" already describes the failure state accurately; it must be updated when this lands.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
curl -s https://three.ws/api/custody/integrity | head -c 900
curl -sI https://three.ws/integrity | head -1
for u in https://api.mainnet-beta.solana.com https://api.devnet.solana.com; do
  curl -s -X POST $u -H 'content-type: application/json' \
   -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH"]}'; echo; done
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -E "CUSTODY_|ATTEST_AGENT"
grep -n "ANCHOR_NETWORK\|anchor_error" api/_lib/custody-proof.js
```

If the anchors have started landing (epochs_anchored above 0 and latest epoch `anchored`), skip tasks 2 to 3 and do the alert, page and docs work.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Capture the actual failure reason: query the stored `anchor_error` for the latest epochs (read-only via the project's DB tooling, `npm run db:status` first for connectivity; or temporarily log from a local run of `runAttestationEpoch({ anchor: true })` against a branch DB with devnet). Confirm it is the unfunded-payer rejection. State the finding in the report.
2. Test first in `tests/custody-proof-epoch.test.js` (extend, injecting a failing `sendAndConfirm`): an `Attempt to debit an account but found no record of a prior credit` rejection is stored as `anchor_error = 'attester_unfunded:<network>'` (new classification helper next to `markAnchorFailed`), and a second consecutive failure does not rewrite a healthy state. Then implement the classification.
3. Alerting: `api/cron/custody-attest.js` calls the same `sendOpsAlert` helper the reasoning ledger uses (`grep -n sendOpsAlert api/cron/reconcile-decisions.js` for the import) when an epoch ends `anchor_failed`, naming the network, the attester pubkey (public), its current balance on that network (`getBalance`), and the fix. Dedupe by signature `custody-anchor-failed:<network>` so it fires once per outage, mirroring `tests/cron-ledger-anchor-outage.test.js` (write the failing test first).
4. Move the anchor to where the attester is funded: set `CUSTODY_ANCHOR_NETWORK=mainnet` with `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars CUSTODY_ANCHOR_NETWORK=mainnet` (config-only and pre-approved; use `--update-env-vars`, never `--set-env-vars`). The auto-topup already keeps this signer at or above 0.02 SOL on mainnet (`api/_lib/solana-signers.js`, crons `treasury-topup`, `relayer-balance-check`); a memo costs about 5,000 lamports, four epochs a day. Change the code default in `api/_lib/custody-proof.js` to `mainnet` (and update the comment) so the config and the code agree, and make the client verifier (`src/proof-of-custody/verifier.js`, `ui.js`) read `anchor_network` from the response rather than assuming a cluster (it already receives it; add a test).
5. Anchor the current state: after the owner deploys (or against the already-running service), trigger one epoch (`gcloud scheduler jobs run` for the custody-attest job, find its name with `gcloud scheduler jobs list --location us-central1 | grep custody`) and confirm `epochs_anchored >= 1`, then verify the memo on-chain: `solana confirm -v <anchor_sig>` or `getTransaction` shows the SPL-Memo with `kind`, `epoch`, `root` equal to the API's `merkle_root`. Do not mass re-anchor the 522 historical roots: a late timestamp on an old root would imply it was published earlier. Instead leave them `anchor_failed` and add a `backlog` count to the integrity response, so the page can say "anchoring began on <date>; earlier epochs were recorded but not timestamped".
6. Restore the public page only on the strength of real anchors: re-add the `/integrity` route to `vercel.json`, the Vite entry, and the in-product links removed by `d44332275` (read it with `git show d44332275` and reverse the route/link pieces). Update `pages/integrity.html` / its script so the headline reflects the data: it shows `epochs_anchored` of `epochs_total`, the latest anchored epoch with an explorer link on the right cluster, and an honest banner when the latest epoch is not anchored. Guard: if `epochs_anchored` is 0 the route serves the existing 404 behaviour (a server-side check in the page script is not enough; gate the link visibility in `src/proof.js` on `epochs_anchored > 0`). Skeleton loading, empty and error states, hover/focus/active states on every control, and a browser check including `/proof` for a real agent wallet verifying inclusion end to end against the new on-chain root.
7. Also confirm the sibling lanes now work with a funded mainnet attester and fix what is still broken: run `curl -s https://three.ws/api/ledger/verify/<an agent id with decisions>` (find one from `GET /api/agents/...` public stats) and check whether the reasoning-ledger head is `verified` rather than `verified_unanchored`; check `trader-score-attest`. If either still fails with a different cause, diagnose with the same method and fix with a test first.
8. Docs: rewrite the `docs/custody.md` "Honest limits" and aggregate-view bullets to the new truth (anchor network, backlog semantics, `/integrity` back), add the env var to `.env.example` and the ops notes, and a `data/changelog.json` entry; run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/custody-proof-epoch.test.js tests/custody-merkle.test.js tests/custody-public-endpoints.test.js tests/cron-ledger-anchor-outage.test.js tests/solana-signers-attester.test.js` passes, including the new failure-classification and alert-dedupe tests (each seen failing first).
- [ ] `curl -s https://three.ws/api/custody/integrity | jq '.data.epochs_anchored, .data.latest.anchor_status, .data.latest.anchor_network'` prints a number above 0, `"anchored"`, `"mainnet"`.
- [ ] An on-chain read of the latest `anchor_sig` on mainnet shows a Memo program instruction whose JSON `root` equals `.data.latest.merkle_root`.
- [ ] `curl -sI https://three.ws/integrity | head -1` is `HTTP/2 200` only when `epochs_anchored > 0`; the page loads in a browser with zero console errors and a working inclusion verification on `/proof`.
- [ ] A forced failure (point `CUSTODY_ANCHOR_NETWORK` at devnet locally with an unfunded key) produces exactly one ops alert and `anchor_error = attester_unfunded:devnet`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot read `anchor_error` from the production database | Reproduce locally: run `runAttestationEpoch({ anchor: true })` with the same code and a throwaway unfunded keypair on devnet; the rejection text is deterministic. The public balance reads already prove the funding gap. |
| Attester mainnet balance dips below what is needed | The `reasoning-ledger-attester` signer is in `SOLANA_SIGNERS` and the existing 30-minute top-up cron refills it. Check `curl -s https://three.ws/api/cron/...` health through `npm run logs`; if the cron is not topping up, fix that cron with a test. |
| Production deploy needed to ship the code default and alert | The `gcloud ... --update-env-vars` change delivers the fix immediately; commit the code and say the deploy is the owner's one command (`npm run deploy:gcp:full`). |
| Scheduler job name unknown | `gcloud scheduler jobs list --location us-central1 --project aerial-vehicle-466722-p5 | grep -i custody`. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/265-plan-custody-proof-anchor-restore.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `265-plan-custody-proof-anchor-restore.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/custody.md` (whole file)

~~~~markdown
# Custody you can verify: limits, freeze, proof, recovery

Every three.ws agent gets a custodial Solana wallet so it can act autonomously - trade, pay x402 endpoints, snipe - without you approving every transaction. Custodial is a strong word, so the platform's position is: **provable, not promised**. This doc is the public story of the controls: what limits you can set, what the freeze switch does, how you independently verify custody on-chain, and how a wallet survives a lost account - or its owner.

The four guarantees, each with a verification path:

1. **You cap it.** Opt-in spend limits are enforced server-side before anything is signed.
2. **You can stop it.** A one-tap freeze pauses every autonomous path - and never blocks your own withdrawal.
3. **You can check it.** Every wallet's balance is committed into a Merkle attestation on a schedule, and you can re-verify your leaf in your own browser.
4. **You can lose your keys, or die, without losing the wallet.** Social recovery and a dead-man's-switch inheritance flow transfer ownership - never the secret.

## Spend limits: caps enforced before signing

Limits live per agent and are owner-configurable from the wallet hub (API: `GET/PUT /api/agents/:id/solana/limits`):

- `daily_usd` - rolling 24-hour ceiling, summed over the custody event trail
- `per_tx_usd` - single-transaction ceiling
- `withdraw_allowlist`, destinations the wallet may send to, managed as the [destination whitelist](./destination-whitelist.md) (cooldown, step-up, instant removal)
- Plus a trade-side daily SOL budget for trading agents

Enforcement is uniform: the same policy module gates **every** outbound path - withdrawals, x402 payments, sniper buys, trades. A transaction that would breach a cap is refused with a structured `403` before signing; no funds move. Limits are opt-in (`null` means uncapped) - but they're hard once set. SPL tokens that can't be priced in USD are governed by the allowlist instead, so a price-feed outage can never strand your own withdrawal.

You can also write these rules in plain English - see [financial-controls](financial-controls.md) for the natural-language rules layer and the real-time defense behaviors built on top of this same enforcement point.

## Freeze: the kill switch that can't trap you

`frozen` is a one-tap owner control. When set, **all autonomous spending stops** - trading, sniping, x402 - at the same server-side gate as the limits. Two deliberate asymmetries:

- **Owner withdrawal is never blocked by a freeze.** Freezing a misbehaving agent must not take your funds hostage.
- During a recovery dispute (below), the wallet is auto-frozen - but that automatic freeze is tracked separately, so it lifts when the dispute resolves without overriding a freeze *you* set.

## Withdraw any time

`POST /api/agents/:id/solana/withdraw` - owner-authenticated, server-signed, idempotent. Destination addresses are validated on-curve (program-derived addresses are rejected), Max-sweeps hold back the rent and fee reserve, and every withdrawal lands in the custody trail and the platform audit log.

## The custody audit trail

Every key recovery, withdrawal, spend, limit change, and freeze toggle is written to the wallet's custody event trail - owner-viewable at `GET /api/agents/:id/solana/custody`. This trail isn't decorative: it's the ledger the rolling daily cap is computed from, and its head is committed into every proof-of-custody leaf (below), which means the attestation also commits to the *history* of the wallet, not just its balance.

## Proof of custody: verify it yourself

Every six hours, an attestation epoch runs:

1. Every custodial wallet's **live mainnet balance** is read.
2. Each wallet becomes a leaf: agent, address, balance, and the current head of its custody event trail, hashed together.
3. The leaves build a Merkle tree; the epoch and leaves are persisted.
4. The root is anchored on Solana as a signed SPL-Memo transaction, when an attester key is configured and funded (see **Honest limits** below).

Two public surfaces, one of which is currently API-only:

- **The aggregate view** is `GET /api/custody/integrity` and `GET /api/custody/anchor?epoch=latest`: latest epoch, Merkle root, the anchor transaction (once an epoch is anchored), wallet count, total SOL, recent epochs. No sign-in. The `/integrity` page that rendered this is **switched off** while anchoring is unavailable, because a page headlined "custody you can verify" is misleading when no epoch has an on-chain anchor to verify against (see **Honest limits** below). The endpoints stay public and unchanged, so nothing that reads them breaks; re-routing the page is the last step of restoring anchoring, not a separate project.
- **[/proof](https://three.ws/proof)** is your wallet's inclusion proof (owner-only, since it reveals a per-wallet balance). The page fetches your proof and then **re-verifies it in your browser** with an independent verifier: it recomputes your leaf hash from the public fields, walks the Merkle path, and checks the result against the epoch's published root. The prover and verifier share one hashing module, so they cannot silently drift. Where the epoch is anchored, that same root is what the on-chain memo commits to.

Epochs also run a reconciliation pass: any balance drop since the previous epoch must be explained by authorized withdraw/spend events (plus fee tolerance), or it's flagged. "No unexplained outflows" is a checked property, not a slogan.

**Honest limits.** Anchoring is best-effort and is the one step in this pipeline that can fail on its own. Steps 1 to 3 (balance snapshot, leaf hashing, Merkle tree, persistence) always run; step 4 needs a configured, funded attester key, and when it does not have one the epoch is still recorded and served with `anchor_status` set to `anchor_failed` rather than `anchored`, and a null `anchor_sig`. A root in that state is a real, reproducible commitment you can verify your inclusion against, but it is not yet timestamped on a public chain, so it does not prove the platform published it before you asked.

Check the epoch you are relying on rather than assuming: `GET /api/custody/integrity` reports `epochs_total` against `epochs_anchored`, and `GET /api/custody/anchor?epoch=latest` returns that epoch's `anchor_status`, `anchor_sig`, and `anchor_network`. The anchor network is deployment-configurable and may be Solana devnet rather than mainnet, so read `anchor_network` before treating any anchor as mainnet-final. Balance reads are mainnet regardless of where the anchor lands.

## Social recovery & inheritance

A funded agent shouldn't die with a lost password - or with its owner. The model is **ownership transfer, never key export**: recovery re-points the agent (and its avatar) to a new owner account. The wallet secret is never decrypted, displayed, or moved; it stays encrypted at rest and the platform simply signs for the new owner afterward. There is nothing for an attacker to intercept.

**Setup (owner):** name up to 10 guardians (by username, @handle, email, or id), an approval threshold (default 2-of-N), and optionally a beneficiary - from the agent's wallet hub (`PUT /api/agents/:id/recovery`).

**Recovery:** a guardian or the beneficiary opens a request nominating the new owner. Safety rails, in order:

- The requester **cannot approve their own takeover** - at least one other guardian must approve.
- The wallet **auto-freezes for autonomous spend** the moment a request opens (owner withdrawal stays open, as always).
- Threshold approvals start a **48-hour time-lock** before the transfer can complete.
- The real owner can cancel instantly at any point - their presence defeats the request.
- Unmet requests expire after 14 days.

**Inheritance (dead-man's switch):** the owner enables it with an inactivity threshold (7-365 days) and a grace window. "Alive" is inferred from sessions, custody events, usage, or an explicit check-in. When inactivity crosses the line, an inheritance request opens to the beneficiary; it needs guardian confirmation (or the beneficiary's own, if no guardians are set) *and* the grace window; a daily sweep arms, reminds (about a week ahead), and completes; any owner check-in cancels the whole thing.

**The guardian console, [/guardian](https://three.ws/guardian)**, is the inbox for the *other* side: agents where you are the guardian or beneficiary, the active request's story, approval counts, countdowns, and the approve / decline / confirm actions. (Not to be confused with the Guardian *content-safety* model, `@three-ws/guardian`, which is an unrelated AI-moderation surface.)

Every step of recovery and inheritance writes to the custody trail and the audit log, and notifies everyone involved.

## Related

- [Financial controls](financial-controls.md) - plain-English spend rules and real-time wallet defense on these rails
- [Trading surfaces](trading-surfaces.md) - Mission Control executes through this same guarded path
- [The trading experiment](trading-experiment.md) - an autonomous agent operating inside these limits, journaled
- [x402](x402.md) - the payment protocol these wallets spend over
~~~~

