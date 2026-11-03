# Extract the production Solana x402 facilitator into @three-ws/x402-server/facilitator with sponsor guards and an attack suite

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/700-plan-x402-self-hostable-solana-facilitator.md`.

**Priority:** P2, new capability with clear value (score 71 of 100 inside the tier). **Area:** x402. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Every Solana x402 merchant using `@three-ws/x402-server` settles through someone else's facilitator, because `DEFAULT_FACILITATOR_URL` is a hosted third party. three.ws already runs a hardened Solana facilitator in production (`api/_lib/x402/self-facilitator.js`, 1385 lines, plus `api/x402-facilitator/[action].js`), with a sponsor SOL floor, fee budget, minimum sponsored settle, payTo allowlist and settle recovery, but it is welded to platform env, the platform RPC helper and the platform database, so nobody else can run it. Extracting it makes the package a complete merchant stack, puts the platform's own endpoint on the same published code (so the package is proven by production), and produces the adversarial test suite that any Solana facilitator can run. This is also the engineering core of the Solana Foundation grant draft, so finishing it makes that application submittable.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `packages/x402-server` is at 0.1.3 with zero runtime dependencies and only `src/index.js`, `src/http.js`, `src/index.d.ts`, `test/`, `examples/`. There is no `src/facilitator/` and no `./facilitator` subpath export.
- `api/_lib/x402/self-facilitator.js` exports `SELF_FACILITATOR_ENABLED`, `SPONSOR_SOL_FLOOR_LAMPORTS`, `MIN_SPONSOR_SETTLE_ATOMIC`, `loadFeePayerKeypair`, `payToAllowlist`, `validateRingTransaction`, `verifyBuyerSignatures`, `blockhashIsLive`, `txBase64FromPayload`, `sponsorKnownBelowFloor`, `isFeePayerRentFailure`, `noteSponsorRentFailure`, `refreshSponsorFloorState`, `sponsorSolLamports`, `settleRingPayment`, `verifyRingPayment`, `probeSettlementSignature`. Platform couplings: `env` from `api/_lib/env.js`, `solanaConnection` from `api/_lib/solana/connection.js`, `api/_lib/solana-token-program.js`, and `api/_lib/x402/pending-settlements.js` (database-backed pending and terminal settlement records), plus `process.env.X402_FEE_PAYER_SECRET_BASE58`, `X402_SPONSOR_SOL_FLOOR_LAMPORTS`, `X402_SELF_FAC_MIN_SETTLE_ATOMIC`, `X402_SELF_FACILITATOR_PAYTO_ALLOWLIST`.
- Existing facilitator tests to port or keep passing: `tests/x402-self-facilitator-{fee-meter,floor-accounting,min-settle,settle-recovery,settleable,signatures}.test.js`, `tests/x402-facilitator-memo-interop.test.js`, and under `tests/api/` the facilitator dispatch, durable log and healthz tests.
- The grant draft `marketing/growth/applications/gated/solana-foundation-grant.md` (uncommitted, commit-gated) lays out milestones M1 to M4 and quotes 951 lines; the file is now 1385, so measure again.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
ls packages/x402-server/src packages/x402-server/test
node -e "console.log(require('./packages/x402-server/package.json').exports)"
wc -l api/_lib/x402/self-facilitator.js "api/x402-facilitator/[action].js"
grep -n "^import\|process.env" api/_lib/x402/self-facilitator.js | head -40
ls tests | grep -i facilitator; ls tests/api | grep -i facilitator
(cd packages/x402-server && node --test 2>&1 | tail -8)
curl -s https://three.ws/api/x402-facilitator | head -c 800
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Design the seam first. Write the option surface (no code moved yet) in `packages/x402-server/src/facilitator/index.d.ts`: `createFacilitator({ network, connection | rpcUrls[], feePayer (signer interface, not a raw secret), payToAllowlist, guards: { sponsorSolFloorLamports, feeBudget: { lamports, windowMs }, minSponsoredSettleAtomic }, store (settlement and decision log sink interface: get, putPending, putTerminal, log), clock })`. The platform's database-backed `pending-settlements.js` becomes one implementation of `store`; an in-memory store is the default for self-hosters. Reuse the platform's existing semantics exactly (SETTLEMENT_PENDING_REASON, idempotent settle keys).
2. Extract. Move the verify and settle logic into `packages/x402-server/src/facilitator/` and export it as the subpath `@three-ws/x402-server/facilitator` in `package.json` `exports`. Keep the package root zero-dependency: Solana libraries (`@solana/web3.js`, `@solana/spl-token`, `bs58`, `@noble/curves`) are `peerDependencies` loaded only through the subpath. Where the upstream `@x402/svm` exact facilitator already covers a transaction-shape check, delegate to it as an optional peer rather than duplicating; keep the three.ws checks that upstream lacks.
3. Re-point production at the package without behavior change. `api/_lib/x402/self-facilitator.js` becomes a thin adapter that injects the platform connection, `loadFeePayerKeypair`, the database store and env-derived guard values, then re-exports the same names so existing importers (grep `self-facilitator` in `api/`, `scripts/`, `tests/`) do not change. Run the existing facilitator tests unchanged before and after; they are the regression net. Expose the package version in the `GET /api/x402-facilitator` response.
4. Guards as first-class, individually configurable and documented: sponsor SOL floor, fee budget meter, minimum sponsored settle, recipient allowlist, rent-failure detection with bounded ATA-create rent, idempotent settle with lost-confirmation recovery, and the durable decision log with machine-readable refusal reasons. One focused test per guard in `packages/x402-server/test/facilitator-*.test.js`, derived from the existing root tests.
5. Adversarial suite: `packages/x402-server/test/attacks/` plus a CLI entry (`npx @three-ws/x402-server attack --facilitator <url>`) that builds signed-but-malicious Solana transactions and posts them to any facilitator's `/verify` and `/settle`: fee-payer lamport drain, priority-fee inflation, compute-unit abuse, dust griefing, recipient substitution, mint substitution, extra instructions, duplicate submission, lost-confirmation replay. At least 20 cases, each asserting a specific refusal reason. Run it against the local facilitator on devnet or a local validator only. Do not run it against mainnet or third-party facilitators.
6. Self-host path: `packages/x402-server/examples/facilitator/` with a one-file server, a `Dockerfile`, and an operator guide `packages/x402-server/docs/operating-a-facilitator.md` covering fee-payer generation and funding, floors and budgets, RPC failover, monitoring, and what every refusal reason means. Add a public read-only metrics route on the existing facilitator handler (`api/x402-facilitator/[action].js`, action `metrics`) reporting settles, verifies, refusals by reason and sponsor lamports burned, split into internal canary traffic and external payers. Document in the guide that current settle volume is the platform's own canary loop (`docs/x402-ring-economy.md`) and not third-party adoption.
7. Release prep (no publish): bump `packages/x402-server` to 0.2.0, update its README and `index.d.ts`, add the subpath to `scripts` that check vendored or published packages if any list exists (`npm run check:vendored`, `grep -rn x402-server scripts`), a `STRUCTURE.md` row, and a `data/changelog.json` entry. The npm publish and the upstream pull request to the x402 reference repository are prepared as ready-to-run commands and a drafted issue text in `docs/`, not executed.
8. Run `cd packages/x402-server && node --test`, the root facilitator tests, `npm test`, `npm run check:rules -- --paths <files>`, `npm run audit:docs`. Confirm production parity locally by running the facilitator handler against a local validator with the package wired in, settling one USDC-style transfer end to end.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node -e "console.log(Object.keys(require('./packages/x402-server/package.json').exports))"` lists `./facilitator`, and `node --test packages/x402-server/test` passes including at least 20 attack cases and one test per guard.
- [ ] `api/_lib/x402/self-facilitator.js` imports its logic from the package; the unchanged root facilitator tests pass.
- [ ] `grep -c '"dependencies"' packages/x402-server/package.json` shows no new runtime dependency on the root entry (Solana libraries are peers).
- [ ] The local end-to-end settle on a local validator or devnet succeeds, and the attack CLI against the local instance reports every case refused with the expected reason.
- [ ] `GET /api/x402-facilitator` (local) reports the package version, and the `metrics` action returns the internal versus external split.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Platform database store is awkward to inject | Define the `store` interface from the four calls `pending-settlements.js` actually makes; keep the DB implementation in `api/_lib`, ship an in-memory store in the package |
| Mainnet verification would need real funds | Verify on a local validator or devnet. The production facilitator is already live and logged; parity is shown by the unchanged regression tests |
| Upstream reference package has a different transaction-check API | Wrap it behind an adapter and keep the local check where it differs; note the delta in the operator guide |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The grant draft and this package reference crypto projects other than $THREE (the Solana Foundation, USDC, the x402 reference packages and other hosted facilitators). Any commit whose diff names them (docs, comments, tests, the drafted issue text) needs the owner's explicit approval first; ask once, batched at the end, and keep `marketing/growth/applications/gated/solana-foundation-grant.md` uncommitted. The npm publish, the upstream pull request and the grant submission are external posting actions the owner performs; leave them as prepared, ready-to-run steps.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/700-plan-x402-self-hostable-solana-facilitator.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `700-plan-x402-self-hostable-solana-facilitator.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `marketing/growth/applications/gated/solana-foundation-grant.md` (whole file)

~~~~markdown
# Solana Foundation grant proposal: sponsor-safe, self-hostable x402 facilitation for Solana

**Status: draft, not submitted. Commit-gated.** This file names crypto projects other than $THREE (the Solana Foundation, USDC, other x402 facilitators and packages), so under the CLAUDE.md commit gate it stays uncommitted until the owner approves the content. Nothing here has been sent to the Solana Foundation.

- Opportunity row: `marketing/growth/opportunities.csv`, "Solana Foundation public-good grant", status `scope_needed`, target date 2026-10-16.
- Program page: https://solana.org/grants-funding
- Application form: https://share.hsforms.com/1GE1hYdApQGaDiCgaiWMXHA5lohw ("Solana Foundation Funding Application")
- Form guidance: https://docs.google.com/document/d/1eK-WNhQmQFyk06XhwWRZJrXn3z_0NDbChZ_Rm8XRoXw
- Evidence gathered: 2026-09-17.

---

## 1. What the Foundation asks for (verified 2026-09-17)

- **Funding types.** Milestone-based grants for public goods, convertible grants for public goods with a commercial component, and Requests for Proposals. This proposal is a **milestone-based public-good grant**.
- **Public good definition.** A project that "either makes a significant open-source contribution to the Solana ecosystem, or if it has a meaningful free community offering."
- **Required.** A project overview, how it delivers public value, "a well structured budget proposal, and include thoughtful milestones", open-sourced learnings, and an answer to "Why Solana?"
- **Milestones.** The guide asks for "measurable milestones for both Product Development and Adoption", each unlocking a stated portion of funding.
- **Process.** Rolling review (about one week), optional due diligence (about three weeks to a decision), then legal finalization. No typical amount is published.
- **Form fields.** Company name, website, country, legal first and last name, email, Solana on-chain accounts, funding amount, funding category, the project, open-source status, amount plus milestones, usage metrics, competition, public good, why you.

---

## 2. Choosing the scope: one package, one gap

### Candidates considered

All are Apache-2.0 and live in this repository. Download counts are npm's own API (`api.npmjs.org/downloads/point/last-month`, window 2026-08-13 to 2026-09-11, fetched 2026-09-17). npm counts include mirrors and CI installs, so they indicate reach, not users.

| Package | What it is | npm last month | Why not chosen (or chosen) |
|---|---|---|---|
| `@three-ws/metaplex-agent-mcp` 0.2.1 | MCP server that registers agents in the Metaplex Agent Registry | 944 | Highest reach, but a wrapper over an existing registry; the grant would fund convenience, not a missing primitive |
| `@three-ws/vanity` 0.1.3 | Solana vanity address grinder | 374 | Well-served category already |
| `@three-ws/skill-license` 0.1.2 | Skill licenses as SPL NFTs plus a PDA | 366 | Narrow audience today |
| `@three-ws/onchain-agent-wallets` 0.1.1 | Agent spending allowance enforced by the SPL Token program | 356 | Strong idea, little production evidence yet |
| `@three-ws/solana-agent` 0.2.2 | Solana agent SDK (keypair, wallet adapter, transfers, x402 exact) | 333 | Broad SDK; hard to scope one verifiable public good |
| **`@three-ws/x402-server` 0.1.3** | **Merchant side of x402: issue the 402, verify, settle, fee split; Solana leads** | **228 (1,559 from first publish 2026-06-24 to 2026-09-16)** | **Chosen: backed by the platform's largest body of production evidence, and the grant closes a verified gap (below)** |

### The gap (verified against code)

1. **Every Solana x402 merchant depends on someone else's facilitator.** `@three-ws/x402-server` settles through a facilitator URL, and its `DEFAULT_FACILITATOR_URL` is a hosted third-party service (`packages/x402-server/src/index.js`). The same is true of most x402 merchant tooling.
2. **three.ws already runs its own Solana facilitator in production, but it is not reusable.** `api/_lib/x402/self-facilitator.js` (951 lines) plus `api/x402-facilitator/[action].js` verify and settle Solana USDC with the platform's own fee payer over its own RPC. It reads platform env vars, the platform connection helper, and a platform payTo allowlist, so nobody else can adopt it.
3. **The reference Solana facilitator does not protect the sponsor's SOL balance.** The upstream `@x402/svm` exact facilitator (x402-foundation/x402, `typescript/packages/mechanisms/svm/src/exact/facilitator/scheme.ts`, read 2026-09-17) validates the transaction shape well: it rejects a fee payer that transfers funds, caps compute-unit price, checks mint, amount, recipient, and memo. It contains no sponsor balance floor, no fee budget over time, and no minimum settle amount. Those are the failures that actually stopped settlement in production here (section 4).

### The scope, in one sentence

**Add a self-hostable, sponsor-safe Solana facilitator to `@three-ws/x402-server`, extracted from the production three.ws facilitator and built on the upstream `@x402/svm` transaction checks, so any Solana merchant can verify and settle x402 payments with their own fee payer and cannot be drained or griefed; contribute the sponsor guards and the attack tests upstream.**

Deliberately out of scope: EVM chains, new token programs, hosted services, dashboards beyond one public metrics endpoint, and anything involving $THREE.

---

## 3. Why Solana

- **Fee-payer sponsorship is native.** A Solana transaction names its fee payer, so the facilitator co-signs as fee payer and the buyer needs no SOL, only USDC. That is what lets an AI agent with nothing but a stablecoin balance pay per call. The same property is the risk this grant fixes: the fee payer signs the whole transaction, so a careless facilitator can be drained (the production code's own security note documents this vector).
- **Per-call pricing survives the fee.** Production sets a minimum sponsor-mode settle of 1,000 atomic USDC ($0.001) because each co-sign burns about 5,000 lamports (`MIN_SPONSOR_SETTLE_ATOMIC` in `self-facilitator.js`). A tenth-of-a-cent API call that still covers its own settlement cost is the economics x402 needs.
- **SPL `TransferChecked` plus Memo** gives a strict, decodable instruction set the facilitator can validate exactly before signing.

---

## 4. Production evidence (how each number was checked)

| Claim | Evidence | Method |
|---|---|---|
| The facilitator is live | `GET https://three.ws/api/x402-facilitator` returns `"service":"three.ws self-hosted x402 facilitator"`, `x402Version: 2`, `exact` on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, fee payer `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | curl, 200 |
| Lifetime volume (since 2026-07-03) | 136,534 successful settles, 932,590 successful verifications, 2,832.536 USDC moved | read-only query of `x402_self_facilitator_log` |
| Last 30 days | 8,594 successful settles from 3 payer wallets | same table |
| Guards fire in production | 775,408 refused settles; the largest reasons are `fee_runway_exhausted` (fee budget cap) and `fee_wallet_below_floor` (sponsor floor), plus `payer_fee_unfunded` and simulation failures on verify | same table, grouped by `reject_reason` |
| Independent listing | x402scan lists it at https://www.x402scan.com/facilitator/three-ws since `Merit-Systems/x402scan` PR #1032 merged 2026-08-11 | curl 200, `gh pr view` |
| Tested | 71 facilitator test cases across `tests/x402-self-facilitator-{settleable,floor-accounting,fee-meter,min-settle,settle-recovery}.test.js`, `tests/api/x402-facilitator-dispatch.test.js`, `tests/api/x402-facilitator-log-durable.test.js`, `tests/api/healthz-self-facilitator.test.js`; the package's own suite passes 25 of 25 (`node --test`, run 2026-09-17) | test files, local run |
| Package published | `@three-ws/x402-server` versions 0.1.0 (2026-06-24) through 0.1.3 (2026-09-11), zero runtime dependencies | npm registry |

**Honesty note that must stay in any submitted text.** The settlement volume is the platform's own autonomous canary loop (`docs/x402-ring-economy.md`): platform-controlled payer wallets paying platform endpoints, with a single platform payTo, to prove every paid route settles end to end. In the last 30 days no successful settle came from a payer outside the ring wallet table. The numbers prove the facilitator and its guards under sustained load. They are not third-party adoption, and the proposal must not describe them that way. The large refusal count is the guards doing their job under a deliberately tight fee budget, and should be explained, not hidden.

---

## 5. Milestones

T0 is the date the grant agreement is signed. Every deliverable is public and checkable by the Foundation without access to three.ws systems. Each milestone releases the share of funding shown in section 7.

### M1. Standalone facilitator module (development), T0 + 3 weeks

- Move the verify and settle path out of platform code into `packages/x402-server/src/facilitator/`, published as the subpath export `@three-ws/x402-server/facilitator`. The zero-dependency core stays zero-dependency; Solana libraries load only through the subpath.
- Every platform coupling becomes an explicit option: RPC connection or URL list (failover), fee-payer signer, payTo allowlist, log sink.
- Transaction-shape validation delegates to the upstream `@x402/svm` exact facilitator checks wherever they cover the case, instead of duplicating them (open source first); three.ws-specific checks stay only where upstream has no equivalent.
- The production three.ws endpoint switches to the package, so the package is what runs in production from this milestone on.

**Verifiable deliverable:** npm release with the subpath export; `README.md` with a runnable example that stands up a facilitator in one file; the existing 71 facilitator tests ported to the package and passing in `node --test`; `https://three.ws/api/x402-facilitator` still answering, now served by the published version (version string exposed in the response).

### M2. Sponsor guards (development), T0 + 6 weeks

Ship as documented, individually configurable guards, all proven in production today:

- **Sponsor SOL floor:** refuse to settle when the fee payer is below a configured balance (production default 0.02 SOL, `SPONSOR_SOL_FLOOR_LAMPORTS`).
- **Fee budget meter:** cap lamports burned per rolling window (`fee_runway_exhausted` in production).
- **Minimum sponsored settle:** refuse dust transfers that cost the sponsor more in fees than they move (`MIN_SPONSOR_SETTLE_ATOMIC`).
- **Recipient allowlist:** co-sign only transfers to merchant-controlled accounts.
- **Rent-failure detection and bounded ATA-create rent**, so a new recipient token account cannot become an open-ended rent drain.
- **Idempotent settle and settle recovery:** a retried settle never double-broadcasts, and a broadcast whose confirmation was lost is reconciled rather than repeated.
- **Durable decision log interface:** every verify and settle, with a machine-readable refusal reason.

**Verifiable deliverable:** npm release; one test per guard; a `docs/` page in the package explaining each guard, its default, and the failure it prevents.

### M3. Adversarial test suite and upstream contribution (development plus ecosystem), T0 + 9 weeks

- An attack suite of signed-but-malicious Solana transactions run against the facilitator: fee-payer lamport drains, priority-fee inflation, dust griefing, recipient substitution, mint substitution, duplicate submission, lost-confirmation replay.
- The same suite packaged so any x402 Solana facilitator can run it against its own `/verify` and `/settle` endpoints.
- A pull request to `x402-foundation/x402` adding opt-in sponsor-balance and fee-budget hooks (or equivalent the maintainers prefer) plus the attack cases to `@x402/svm`, with an issue opened first to agree the design.

**Verifiable deliverable:** the suite published in the package with a CLI entry that targets any facilitator URL; the upstream issue and PR links, public. Funding for M3 releases on the PR being opened with passing upstream CI and a maintainer review requested. A merge is not required, because the Foundation should not pay on a third party's schedule; the merge outcome is reported in M5.

### M4. Reference deployment and operator guide (adoption), T0 + 12 weeks

- A one-command self-host path: a `Dockerfile` and an example service in the package, deployable to any container host.
- An operator guide: generating and funding a fee payer, choosing floors and budgets, RPC failover, monitoring, and what each refusal reason means.
- A public read-only metrics endpoint on the three.ws deployment reporting settles, verifications, refusals by reason, and sponsor lamports burned, split into internal canary traffic and external payers.
- Registration of the reference deployment in public x402 facilitator directories where one exists.

**Verifiable deliverable:** the Dockerfile and guide in the repository; the metrics endpoint live; a recorded walkthrough of a fresh facilitator settling a mainnet USDC payment in under 15 minutes from `npm install`.

### M5. Adoption report (adoption), T0 + 6 months

**Verifiable deliverable:** a public report with the section 8 metrics against the section 8 baselines, the upstream PR outcome, every issue filed by outside operators and how it was resolved, and security fixes shipped during the maintenance window.

---

## 6. Timeline

| Week | Work |
|---|---|
| T0 to T0+3 | M1 extraction, production cut-over to the package |
| T0+3 to T0+6 | M2 guards and per-guard docs |
| T0+6 to T0+9 | M3 attack suite, upstream issue and PR |
| T0+9 to T0+12 | M4 self-host path, operator guide, metrics endpoint |
| T0+12 to T0+26 | Maintenance, operator support, upstream follow-through, M5 report |

---

## 7. Budget (proposal, every figure owner-adjustable)

**This table is a starting proposal for the owner to adjust, not a quote.** The Foundation publishes no typical grant size, and the guide asks that the amount be "intentional and explained in the milestones section". Engineering is costed at an assumed blended rate of **$5,000 per engineer-week**; the owner should replace that rate with the real one before submitting. The security review figure is an estimate to be replaced with a real vendor quote.

| Line item | Milestone | Basis | Amount (USD) | Rationale |
|---|---|---|---|---|
| Facilitator extraction and production cut-over | M1 | 2 engineer-weeks | 10,000 | Decouple env, RPC, signer, allowlist, and log sink; port 71 tests; switch production to the package |
| Sponsor guards and per-guard docs | M2 | 3 engineer-weeks | 15,000 | Seven guards, each generalized from platform code, tested, and documented |
| Attack suite and upstream contribution | M3 | 2 engineer-weeks | 10,000 | Malicious-transaction corpus, facilitator-agnostic CLI, upstream design discussion and PR iterations |
| Self-host path, operator guide, metrics endpoint | M4 | 2 engineer-weeks | 10,000 | Container path, guide, public metrics split internal versus external |
| Independent security review of the co-signing path | M2 to M3 | external review, estimate | 10,000 | The fee payer signs whole transactions; a second set of eyes on the validation and guards is the difference between "tested" and "safe to recommend" |
| Mainnet conformance funds | M3 to M4 | SOL for sponsor fees and ATA rent, USDC for test payments | 500 | Attack and conformance runs on mainnet, not only devnet; unspent funds reported in M5 |
| Maintenance and operator support | M5 | 2 engineer-weeks spread over 14 weeks | 10,000 | Issue triage, security fixes, upstream review follow-through |
| **Total** | | | **65,500** | |

Proposed release schedule (also adjustable): M1 15%, M2 25%, M3 20%, M4 20%, M5 20%.

---

## 8. Ecosystem impact and success criteria

**Who benefits.** Any Solana developer who wants to charge per request over HTTP 402 without routing settlement through a third party; any existing facilitator operator who wants the sponsor protections and the attack suite; `@x402/svm` users, if the upstream contribution lands.

**Baselines (2026-09-17), then targets.** Targets are goals the grant is measured against, not claims of current adoption.

| Metric | How measured | Baseline | Target by M5 |
|---|---|---|---|
| Independent operators running the facilitator on mainnet | A public `/supported` endpoint or directory listing that identifies the package, confirmed by the operator | 0 | 3 |
| External (non-canary) payers settling through the three.ws reference deployment, 30 days | M4 metrics endpoint | 0 | 25 |
| `@three-ws/x402-server` npm downloads, last month | `api.npmjs.org/downloads/point/last-month` | 228 | 1,000 |
| Public repositories depending on the package | GitHub dependency search for `@three-ws/x402-server` outside `nirholas/*` | owner to record at submission | 5 |
| Attack cases in the suite, all passing on the package | Suite output in CI log | 0 | at least 20 |
| Upstream contribution | `x402-foundation/x402` PR state | none | opened with review requested (M3); outcome reported (M5) |
| Security review findings | Review report | not reviewed | report published, all high and critical findings fixed |

**Learnings shared openly.** The operator guide, the attack corpus, the security review summary, and the M5 report are all public in the repository under Apache-2.0.

---

## 9. Form answers (copy-ready)

| Field | Draft answer |
|---|---|
| Company name | three.ws |
| Website URL | https://github.com/nirholas/three.ws/tree/main/packages/x402-server |
| Country | **OWNER** |
| First Name / Last Name | **OWNER** (legal name; the guide says no pseudonyms) |
| Email Address | **OWNER** |
| Solana On-Chain Accounts | WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW (facilitator fee payer), wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU (facilitator payTo). Both verified from `GET https://three.ws/api/x402-facilitator` on 2026-09-17. |
| Funding Amount | **OWNER** (proposal: $65,500, see section 7) |
| Funding category | **OWNER** to pick from the live dropdown; the closest fit is payments or developer tooling. Not DeFi. |
| Your project / idea | Section 2 "The scope" sentence, then section 2 "The gap" in three short paragraphs. Not referred by a Foundation partner unless the owner says otherwise. |
| Open sourced? | Yes (Apache-2.0) |
| Amount and milestones | Section 5 milestones with the section 7 release percentages expressed in dollars |
| Usage metrics | Section 4 table, including the honesty note, plus the npm numbers in section 2 |
| Competition | Hosted x402 facilitators that support Solana (for example the public PayAI facilitator, whose `/supported` lists Solana mainnet on 2026-09-17) are convenient but put a third party in the settlement path. The upstream `@x402/svm` reference facilitator is self-hostable and validates transaction shape, but has no sponsor balance floor, fee budget, or minimum-settle guard. This package is self-hosted like the reference and adds the sponsor-economics guards and an attack suite from a facilitator that has run on mainnet since July 2026, and it contributes those back upstream rather than competing with the reference. |
| Public good | Apache-2.0 code, zero-dependency core, a facilitator-agnostic attack suite any operator can run, an operator guide, and an upstream contribution to the shared reference implementation. No token, no fee, no account required to use any of it. |
| Why you | Three months of operating a mainnet Solana facilitator under continuous load: 136,534 settles and 932,590 verifications logged, the guards in section 5 written in response to real failures in that log, 71 facilitator tests, an independent listing on x402scan. **OWNER** to add team background and any Solana hackathon history. |

Do not add website links to answers whose question does not ask for one (form instruction).

---

## 10. Re-verification commands (read-only, run the day you submit)

```bash
curl -s https://three.ws/api/x402-facilitator
curl -s https://three.ws/api/x402-facilitator/supported
for p in x402-server metaplex-agent-mcp vanity skill-license onchain-agent-wallets solana-agent; do
  curl -s "https://api.npmjs.org/downloads/point/last-month/@three-ws/$p"; echo
done
(cd packages/x402-server && node --test test/*.test.js)
gh pr view 1032 -R Merit-Systems/x402scan --json state,mergedAt
```

Settlement counts come from `x402_self_facilitator_log` with `DATABASE_URL` from `.env.local` (SELECT only), filtering `ok` by `action`, and excluding payers in `x402_ring_wallets` for the external-payer figure.

## 11. Owner-only inputs before submission

1. Legal first and last name, email, country (the form requires a real name).
2. The real engineering rate and final funding amount, replacing the section 7 assumption; a real security review quote.
3. Funding category selection from the live dropdown.
4. Team background and any Solana hackathon history for "Why you".
5. Whether any Foundation partner or staff referral exists.
6. Approval to commit this file (commit gate: names projects other than $THREE).
7. Agreement that the honesty note on canary-loop volume appears in the submitted text.
~~~~

